const _table_id_name = "tl-ops-web-service-table";
const _search_id_name = "tl-ops-web-service-search";
const _add_form_btn_id_name = "tl-ops-web-service-form-submit";
const _add_form_id_name = "tl-ops-web-service-form";
let rule = '';
let res_data = {};
let state_data = {}

const tl_ops_web_service_main = function (){
    window.$ = layui.$;
    window.form = layui.form;
    window.table = layui.table;
    window.layedit = layui.layedit;

    tl_ops_web_service_render();
};

//事件监听定义
const tl_ops_web_service_event = function () {
    return {
        add:  tl_ops_web_service_add,
    }
};

//表格cols
const tl_ops_web_service_cols = function () {
    let health_timer_list = state_data ? state_data.health.timer_list || [] : false
    return [[
        {
            field: 'name', title: '服务名称', width:"45%"
        },  {
            field: 'node', title: '节点列表',width:"25%",
            templet : (d)=>{
                return `<p style='text-decoration: underline;color:red;font-weight:700;cursor: pointer;' onclick='tl_ops_web_service_node_manage("${d.name}")'>${d.node.length}个节点</p>`;
            }
        }, 
        {
            field: 'oper', title: '服务健康',width:"30%",
            templet : (d)=>{
                let isNodeEmpty = d.node.length === 0;
                let isChecking = health_timer_list.includes(d.name) && !state_data.service[d.name].health_uncheck;
                let isAutoLoad = rule === 'auto_load'
                return `
                <div onclick="tl_ops_web_service_open_health('${d.name}',${isNodeEmpty})" id="tl-service-check-${d.name}" onmouseleave="tl_mouse_leave_tips()" 
                    style="${(!isChecking && isAutoLoad)?'display: inline-flex;':'display:none;'}"
                    onmouseenter="tl_mouse_enter_tips('tl-service-check-${d.name}','${isNodeEmpty ? '暂无节点': '点击可开启自检'}')"> 
                    <i class="layui-icon layui-icon-play tl-ops-web-service-oper"  style="${isNodeEmpty ? 'color: #d0d9d0;cursor: no-drop;' : ''}"> </i>
                     <b style="margin-left: 8px;">开启自检</b>
                </div>
                <div onclick="tl_ops_web_service_pause_health('${d.name}',${isNodeEmpty})" id="tl-service-check-done-${d.name}" onmouseleave="tl_mouse_leave_tips()" 
                    style="${isChecking?'display: inline-flex;':'display:none'}"
                    onmouseenter="tl_mouse_enter_tips('tl-service-check-done-${d.name}','${d.name}已开启自检，点击可暂停自检')">
                    <i class="layui-icon layui-icon-pause tl-ops-web-service-oper" style="color: #40ed40;margin-right: 10px;" ></i>

                    <i class="layui-icon layui-icon-loading tl-ops-web-service-oper layui-anim layui-anim-rotate layui-anim-loop" 
                        style="cursor: no-drop;color: #40ed40;" ></i>
                    <b style="margin-left: 8px;color: #40ed40;cursor: no-drop;">自检中..</b>
                </div>
                `;
            }
        }
    ]];
};


//开启自检
const tl_ops_web_service_open_health = function (name, isNodeEmpty) {
    if(isNodeEmpty){
        layer.msg("当前服务暂无节点")
        return;
    }
    $.ajax(tl_ajax_data({
        url: '/tlops/state/set',
        data : JSON.stringify({
            tl_ops_state_cmd : 'un-pause-health-check',
            tl_ops_state_service : name
        }),
        contentType : "application/json",
        success : (res)=>{
            tl_ops_web_service_render();
        }
    }));
}

//暂停自检
const tl_ops_web_service_pause_health = function (name, isNodeEmpty) {
    $.ajax(tl_ajax_data({
        url: '/tlops/state/set',
        data : JSON.stringify({
            tl_ops_state_cmd : 'pause-health-check',
            tl_ops_state_service : name
        }),
        contentType : "application/json",
        success : (res)=>{
            tl_ops_web_service_render();
        }
    }));
}

//表格render
const tl_ops_web_service_render = function () {
    axios.get("/tlops/state/get").then((res)=>{
        res = res.data
        if(res.code === 0){
            state_data = res.data
        }
    }).then(()=>{
        table.render(tl_ajax_data({
            elem: '#'+_table_id_name,
            url: '/tlops/service/list',
            cols: tl_ops_web_service_cols(),
            page:true,
            needReloadMsg : false,
            toolbar: '#tl-ops-web-service-toolbar',
            defaultToolbar: ['filter', 'print', 'exports'],
            totalRow: true, //开启合计行
            parseData: function(res){
                res_data = res.data;
                rule = res.data.tl_ops_service_rule;
    
                let datas = [], keys = Object.keys(res.data.tl_ops_service_list);
                for(key in keys){
                    datas.push({
                        name : keys[key],
                        node : Object.keys(res.data.tl_ops_service_list[keys[key]]).length !== 0 
                                ? res.data.tl_ops_service_list[keys[key]] : []
                    })
                }
                datas = datas.sort(function(a, b){return a.name.localeCompare(b.name,'zh-CN')})
    
                $('#tl-ops-web-service-cur-rule')[0].innerHTML = `
                    <b style='color:red;font-size:16px;cursor: pointer;' class="layui-badge layui-bg-red" 
                        id="tl-service-rule" onmouseleave="tl_mouse_leave_tips()"
                        onmouseenter="tl_mouse_enter_tips('tl-service-rule','暂不支持修改, 后续支持手动自检模式 “cus_load” ')">
                        ${rule}
                    </b> 
                    <b> ( ${rule==='auto_load' ? '系统启动时开启自检' : '手动启动某次自检'} )</b>
                `;
    
                //表格外部事件操作
                $('.layui-btn.layuiadmin-btn-useradmin').on('click', function(){
                    let type = $(this).data('type');
                    tl_ops_web_service_event()[type] ? tl_ops_web_service_event()[type].call(this) : '';
                });
    
                //搜索
                form.on('submit('+_search_id_name+')', function(data){
                    tl_ops_web_service_reload(data.field);
                });
    
                //行事件操作
                table.on('tool('+_table_id_name+')', function(obj) {
                    let type = obj.event;
                    let data = obj.data;
                    tl_ops_web_service_event()[type] ? tl_ops_web_service_event()[type].call(this, data) : '';
                });
    
                return {
                    "code": res.code,
                    "msg": res.msg,
                    "count": datas.length,
                    "data": datas
                };
            }
        }));
    })
};

//表格reload
const tl_ops_web_service_reload = function (matcher) {
    table.render(tl_ajax_data({
        elem: '#'+_table_id_name,
        url: '/tlops/service/list',
        where : matcher,
        cols: tl_ops_web_service_cols(),
        page:true,
        needReloadMsg : false,
        toolbar: '#tl-ops-web-service-toolbar',
        defaultToolbar: ['filter', 'print', 'exports'],
        totalRow: true, //开启合计行
        parseData: function(res){
            res_data = res.data;
            rule = res.data.tl_ops_service_rule;
            let datas = [], keys = Object.keys(res.data.tl_ops_service_list);
            for(key in keys){
                datas.push({
                    name : keys[key],
                    node : Object.keys(res.data.tl_ops_service_list[keys[key]]).length !== 0 
                            ? res.data.tl_ops_service_list[keys[key]] : []
                })
            }
            datas = datas.sort(function(a, b){return a.name.localeCompare(b.name,'zh-CN')})
            $('#tl-ops-web-service-cur-rule')[0].innerHTML = `
                <b style='color:red;font-size:16px;cursor: pointer;' class="layui-badge layui-bg-red" 
                    id="tl-service-rule" onmouseleave="tl_mouse_leave_tips()"
                    onmouseenter="tl_mouse_enter_tips('tl-service-rule','暂不支持修改, 后续支持手动自检模式 “cus_load” ')">
                    ${rule}
                </b> 
                <b> ( ${rule==='auto_load' ? '系统启动时开启自检' : '手动启动某次自检'} )</b>
            `;
            return {
                "code": res.code,
                "msg": res.msg,
                "count": datas.length,
                "data": datas
            };
        }
    }));
};

//添加
const tl_ops_web_service_add = function () {
    layer.open({
        type: 2
        ,title: '添加服务服务'
        ,content: 'tl_ops_web_service_form.html'
        ,maxmin: true
        ,minStack:false
        ,area: ['700px', '600px']
        ,btn: ['确定', '取消']
        ,yes: function(index, layero){
            let iframeWindow = window['layui-layer-iframe'+ index]
                ,submit = layero.find('iframe').contents().find('#'+ _add_form_btn_id_name);

            iframeWindow.layui.form.on('submit('+ _add_form_btn_id_name +')', function(data){
                if(!tl_ops_service_data_add_filter(data)){
                    return;
                }
                $.ajax(tl_ajax_data({
                    url: '/tlops/service/set',
                    data : JSON.stringify(res_data),
                    contentType : "application/json",
                    success : (res)=>{
                        tl_ops_web_service_reload();
                    }
                }));
                layer.close(index);
            });
            submit.trigger('click');
        }
    });
};

//管理节点
const tl_ops_web_service_node_manage = function (name) {
    let index = layer.open({
        type: 2
        ,title: '管理服务【'+name+'】节点列表'
        ,content: 'tl_ops_web_service_node.html?service='+name
        ,maxmin: true
        ,minStack:false
        ,area: ['600px', '600px']
        ,end : function () {
            tl_ops_web_service_reload()
        }
    });
    layer.full(index);
};

//过滤数据
const tl_ops_service_data_add_filter = function( data ) {
    for(let key in data.field){
        if(data.field[key] === undefined || data.field[key] === null || data.field[key] === ''){
            layer.msg(key + "未填写")
            return false;
        }
    }
    if(res_data.tl_ops_service_list && res_data.tl_ops_service_list.length === 0){
        res_data.tl_ops_service_list = {}
    }
    
    res_data.new_service_name = data.field.service
    res_data.has_new_service_name = true

    for(let service in res_data.tl_ops_service_list){
        if (service === data.field.service){
            layer.msg("“"+service+"” 名称已存在")
            return false;
        }
    }

    return true
}