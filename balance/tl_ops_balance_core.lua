-- tl_ops_balance
-- en : balance core impl
-- zn : 路由的具体实现，根据用户自定义的service , 自动检查服务节点状态，
--      根据自定义的url, 请求参数，请求cookie，请求头，以及选中的路由策略，路由到合适的服务节点。
-- @author iamtsm
-- @email 1905333456@qq.com

local tl_ops_constant_balance = require("constant.tl_ops_constant_balance");
local tl_ops_constant_limit = require("constant.tl_ops_constant_limit")
local tl_ops_constant_health = require("constant.tl_ops_constant_health")
local tl_ops_constant_service = require("constant.tl_ops_constant_service");

local tl_ops_balance_core_api = require("balance.tl_ops_balance_core_api");
local tl_ops_balance_core_cookie = require("balance.tl_ops_balance_core_cookie");
local tl_ops_balance_core_header = require("balance.tl_ops_balance_core_header");
local tl_ops_balance_core_param = require("balance.tl_ops_balance_core_param");

local cache_service = require("cache.tl_ops_cache"):new("tl-ops-service");
local cache_limit = require("cache.tl_ops_cache"):new("tl-ops-limit");

local cjson = require("cjson");
local tl_ops_utils_func = require("utils.tl_ops_utils_func");
local tl_ops_limit_fuse_token_bucket = require("limit.fuse.tl_ops_limit_fuse_token_bucket");
local tl_ops_limit_fuse_leak_bucket = require("limit.fuse.tl_ops_limit_fuse_leak_bucket");
local shared = ngx.shared.tlopsbalance

local _M = {
	_VERSION = '0.02'
}
local mt = { __index = _M }


-- 获取限流器
local tl_ops_balance_core_get_limiter = function( service_name, node_id )
    -- 服务熔断配置列表
    local limit_list_str, _ = cache_limit:get(tl_ops_constant_limit.fuse.cache_key.options_list);
    if not limit_list_str then
        return nil
    end

    local limit_list_table = cjson.decode(limit_list_str);
    if not limit_list_table and type(limit_list_table) ~= 'table' then
        return nil
    end

    for _, limit_option in pairs(limit_list_table) do
        if limit_option.service_name == service_name then
            if not limit_option.depend then
                return nil
            end
            return limit_option.depend
        end
    end
end


-- 负载核心流程
function _M:tl_ops_balance_core_balance()
    -- 服务节点配置列表
    local service_list_str, _ = cache_service:get(tl_ops_constant_service.cache_key.service_list);

    if not service_list_str then
        ngx.header['Tl-Proxy-Server'] = "";
        ngx.header['Tl-Proxy-State'] = "empty"
        ngx.exit(503)
    end

    local service_list_table = cjson.decode(service_list_str);
    if not service_list_table and type(service_list_table) ~= 'table' then
        ngx.header['Tl-Proxy-Server'] = "";
        ngx.header['Tl-Proxy-State'] = "empty"
        ngx.exit(503)
    end

    -- 负载模式
    local balance_mode = "api"

    -- 先走api负载
    local node, node_state, node_id, host = tl_ops_balance_core_api.tl_ops_balance_api_service_matcher(service_list_table)
    if not node then
        -- api不匹配，走param负载
        balance_mode = "param"

        node, node_state, node_id, host = tl_ops_balance_core_param.tl_ops_balance_param_service_matcher(service_list_table)
        if not node then
            -- param不匹配，走cookie负载
            balance_mode = "cookie"

            node, node_state, node_id, host = tl_ops_balance_core_cookie.tl_ops_balance_cookie_service_matcher(service_list_table)
            if not node then
                -- cookie不匹配，走header负载
                balance_mode = "header"

                node, node_state, node_id, host = tl_ops_balance_core_header.tl_ops_balance_header_service_matcher(service_list_table)
                if not node then
                    -- 无匹配
                    ngx.header['Tl-Proxy-Server'] = "";
                    ngx.header['Tl-Proxy-State'] = "empty"
                    ngx.header['Tl-Proxy-Mode'] = balance_mode
                    ngx.exit(503)
                end
            end
        end
    end

    -- 域名负载
    if host == nil or host == '' then
        ngx.header['Tl-Proxy-Server'] = "";
        ngx.header['Tl-Proxy-State'] = "nil"
        ngx.header['Tl-Proxy-Mode'] = balance_mode
        ngx.exit(503)
    end

    -- 域名匹配
    if host ~= "*" and host ~= ngx.var.host then
        ngx.header['Tl-Proxy-Server'] = "";
        ngx.header['Tl-Proxy-State'] = "pass"
        ngx.header['Tl-Proxy-Mode'] = balance_mode
        ngx.exit(503)
    end

    -- 流控介入
    local depend = tl_ops_balance_core_get_limiter(node.service, node_id)    
    if depend then
        -- 令牌桶流控
        if depend == tl_ops_constant_limit.depend.token then
            local token_result = tl_ops_limit_fuse_token_bucket.tl_ops_limit_token( node.service, node_id)            
            if not token_result or token_result == false then
                ngx.header['Tl-Proxy-Server'] = "";
                ngx.header['Tl-Proxy-State'] = "t-limit"
                ngx.header['Tl-Proxy-Mode'] = balance_mode
                ngx.exit(503)
            end
        end

        -- 漏桶流控 
        if depend == tl_ops_constant_limit.depend.leak then
            local leak_result = tl_ops_limit_fuse_leak_bucket.tl_ops_limit_leak( node.service, node_id)
            if not leak_result or leak_result == false then
                ngx.header['Tl-Proxy-Server'] = "";
                ngx.header['Tl-Proxy-State'] = "l-limit"
                ngx.header['Tl-Proxy-Mode'] = balance_mode
                ngx.exit(503)
            end
        end
    end

    -- 节点下线
    if not node_state or node_state == false then
        -- incr failed count
        local balance_req_fail_count_key = tl_ops_utils_func:gen_node_key(tl_ops_constant_balance.cache_key.req_fail, node.service, node_id)
        local failed_count = shared:get(balance_req_fail_count_key)
		if not failed_count then
			shared:set(balance_req_fail_count_key, 0);
        end
        shared:incr(balance_req_fail_count_key, 1)

        local limit_req_fail_count_key = tl_ops_utils_func:gen_node_key(tl_ops_constant_limit.fuse.cache_key.req_fail, node.service, node_id)
        failed_count = shared:get(limit_req_fail_count_key)
		if not failed_count then
			shared:set(limit_req_fail_count_key, 0);
        end
        shared:incr(limit_req_fail_count_key, 1)
        
        ngx.header['Tl-Proxy-Server'] = node['service'];
        ngx.header['Tl-Proxy-Node'] = node['name'];
        ngx.header['Tl-Proxy-State'] = "offline"
        ngx.header['Tl-Proxy-Mode'] = balance_mode
        ngx.exit(503)
    end
    
    -- 负载成功
    local balance_req_succ_count_key = tl_ops_utils_func:gen_node_key(tl_ops_constant_balance.cache_key.req_succ, node.service, node_id)
    local success_count = shared:get(balance_req_succ_count_key)
    if not success_count then
        shared:set(balance_req_succ_count_key, 0);
    end
    shared:incr(balance_req_succ_count_key, 1)

    local limit_req_succ_count_key = tl_ops_utils_func:gen_node_key(tl_ops_constant_limit.fuse.cache_key.req_succ, node.service, node_id)
    success_count = shared:get(limit_req_succ_count_key)
    if not success_count then
        shared:set(limit_req_succ_count_key, 0);
    end
    shared:incr(limit_req_succ_count_key, 1)

    ngx.var.node = node['protocol'] .. node["ip"] .. ':' .. node["port"];
    ngx.header['Tl-Proxy-Server'] = node['service'];
    ngx.header['Tl-Proxy-Node'] = node['name'];
    ngx.header['Tl-Proxy-State'] = "online"
    ngx.header['Tl-Proxy-Mode'] = balance_mode
end


function _M:new()
	return setmetatable({}, mt)
end


return _M

