// ==UserScript==
// @name         Fusion Loader（GitHub直发版｜超轻量）
// @namespace    ios-userscripts
// @version      1.0.1
// @description  仅注入轻量按钮与面板；按需从 GitHub Raw / jsDelivr 拉取 114/115/116 模块并执行，减少首屏解析开销。
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function(){
  'use strict';
  const CFG = {
    githubUser: 'linxuchen',
    githubRepo: 'Fusion-v3.1g5',
    githubBranch: 'main',
    useJsDelivr: true,
    modulePath114: 'modules/module_114_bili_ig_yt.js',
    modulePath115: 'modules/module_115_image_hosts.js',
    modulePath116: 'modules/module_116_xhs_wechat_sniffer.js',
    module114Url: '',
    module115Url: '',
    module116Url: '',
    autoReloadKey: '__fusion_loader_autostart__',
    openKey: '__fusion_loader_open__',
    startedKey: '__fusion_loader_started__'
  };

  const S = {
    inited: false,
    uiReady: false,
    open: false,
    loading: new Set(),
    started: new Set(),
    loadedUrls: new Set(),
  };

  function gmGet(k, d){ try{ return typeof GM_getValue==='function' ? GM_getValue(k, d) : (localStorage.getItem(k) ?? d); }catch{ return d; } }
  function gmSet(k, v){ try{ if(typeof GM_setValue==='function') GM_setValue(k, v); else localStorage.setItem(k, String(v)); }catch{} }

  function log(msg){
    try{
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      const line = `[${hh}:${mm}:${ss}] ${msg}`;
      console.log('[FusionLoader]', msg);
      const box = document.getElementById('__fusion_loader_log__');
      if (box){ box.value += (box.value ? '\n' : '') + line; box.scrollTop = box.scrollHeight; }
    }catch{}
  }

  function addStyle(css){
    try{ if(typeof GM_addStyle==='function') return GM_addStyle(css); }catch{}
    const s=document.createElement('style'); s.textContent=css; (document.head||document.documentElement).appendChild(s); return s;
  }

  function setupGMShim(){
    if (window.__fusionGMShimReady__) return;
    window.__fusionGMShimReady__ = true;

    if (typeof window.GM_addStyle !== 'function') {
      window.GM_addStyle = function(css){ return addStyle(css); };
    }
    if (typeof window.GM_setClipboard !== 'function') {
      window.GM_setClipboard = function(text){
        try{
          if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text ?? ''));
        }catch{}
        const ta = document.createElement('textarea');
        ta.value = String(text ?? '');
        ta.style.position='fixed'; ta.style.opacity='0'; ta.style.left='-9999px';
        document.body.appendChild(ta); ta.select();
        try{ document.execCommand('copy'); }catch{}
        ta.remove();
      };
    }
    if (typeof window.GM_setValue !== 'function') {
      window.GM_setValue = function(k,v){ gmSet(k, typeof v === 'string' ? v : JSON.stringify(v)); };
    }
    if (typeof window.GM_getValue !== 'function') {
      window.GM_getValue = function(k,d){
        const v = gmGet(k, null);
        if (v == null) return d;
        try{ return JSON.parse(v); }catch{ return v; }
      };
    }
    if (typeof window.GM_xmlhttpRequest !== 'function') {
      window.GM_xmlhttpRequest = function(opts){
        const method = (opts && opts.method) || 'GET';
        const url = opts && opts.url;
        const headers = (opts && opts.headers) || {};
        const body = opts && (opts.data || opts.body);
        fetch(url, { method, headers, body, credentials:'include' })
          .then(async res => {
            const text = await res.text();
            const r = { status: res.status, responseText: text, finalUrl: res.url, readyState: 4, responseHeaders: '' };
            try{ opts.onload && opts.onload(r); }catch{}
          })
          .catch(err => { try{ opts.onerror && opts.onerror(err); }catch{}; });
      };
    }
  }

  function domReady(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, {once:true});
    else fn();
  }
  function idle(fn){
    if ('requestIdleCallback' in window) requestIdleCallback(fn, {timeout: 1500});
    else setTimeout(fn, 300);
  }

  function siteInfo(){
    const h = location.hostname.toLowerCase();
    return {
      host: h,
      isXHS: /(^|\.)xiaohongshu\.com$/.test(h),
      isWeChat: h === 'mp.weixin.qq.com' || h.endsWith('.weixin.qq.com') || h.endsWith('.qq.com') || h.includes('finder') || h.includes('video.qq.com'),
      isImageHosts: h === 't66y.com' || h.endsWith('.t66y.com') || h === 'sehuatang.net' || h.endsWith('.sehuatang.net') || h === 'dmn12.vip' || h.endsWith('.dmn12.vip') || h === 'tu.ymawv.la' || h.endsWith('.ymawv.la'),
      isMedia: h.includes('bilibili.com') || h.includes('instagram.com') || h.includes('youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be')
    };
  }

  function buildRepoBase(){
    const user = String(CFG.githubUser || '').trim();
    const repo = String(CFG.githubRepo || '').trim();
    const branch = String(CFG.githubBranch || 'main').trim();
    if (!user || !repo || /YOUR_GITHUB_USERNAME/i.test(user)) return '';
    return CFG.useJsDelivr
      ? `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}`
      : `https://raw.githubusercontent.com/${user}/${repo}/${branch}`;
  }

  function getUrlById(id){
    if (id === '114' && validateUrl(CFG.module114Url)) return CFG.module114Url;
    if (id === '115' && validateUrl(CFG.module115Url)) return CFG.module115Url;
    if (id === '116' && validateUrl(CFG.module116Url)) return CFG.module116Url;
    const base = buildRepoBase();
    if (!base) return '';
    if (id === '114') return `${base}/${CFG.modulePath114}`;
    if (id === '115') return `${base}/${CFG.modulePath115}`;
    if (id === '116') return `${base}/${CFG.modulePath116}`;
    return '';
  }

  function validateUrl(url){
    return /^https?:\/\//i.test(url || '');
  }

  function fetchText(url){
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: r => resolve(r.responseText || ''),
            onerror: reject
          });
          return;
        } catch {}
      }
      fetch(url, {credentials:'omit'}).then(r => r.text()).then(resolve).catch(reject);
    });
  }

  async function injectModule(id){
    if (S.started.has(id)) { log(`${id} 已启动，跳过重复启动`); return true; }
    if (S.loading.has(id)) { log(`${id} 正在加载中...`); return false; }
    const url = getUrlById(id);
    if (!validateUrl(url)) {
      log(`${id} 未配置外部模块 URL`);
      alert(`请先编辑脚本配置区：要么填 githubUser/githubRepo/githubBranch，要么直接填 module114Url/module115Url/module116Url。`);
      return false;
    }
    S.loading.add(id);
    log(`${id} 拉取中：${url}`);
    try {
      setupGMShim();
      const code = await fetchText(url);
      if (!code || code.length < 100) throw new Error('模块内容为空或过短');
      const blob = new Blob([code + `\n//# sourceURL=fusion-module-${id}.js`], {type:'text/javascript'});
      const blobUrl = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = blobUrl;
        s.async = false;
        s.onload = () => { try{ URL.revokeObjectURL(blobUrl); }catch{} resolve(); };
        s.onerror = (e) => { try{ URL.revokeObjectURL(blobUrl); }catch{} reject(e || new Error('script onerror')); };
        (document.head || document.documentElement).appendChild(s);
      });
      S.started.add(id);
      gmSet(CFG.startedKey, JSON.stringify(Array.from(S.started)));
      log(`${id} 启动完成`);
      return true;
    } catch (e) {
      log(`${id} 启动失败：${e && e.message ? e.message : e}`);
      return false;
    } finally {
      S.loading.delete(id);
    }
  }

  async function startCurrentSite(){
    const s = siteInfo();
    let ids = [];
    if (s.isXHS || s.isWeChat) ids.push('116');
    if (s.isImageHosts) ids.push('115');
    if (s.isMedia) ids.push('114');
    if (!ids.length) {
      log('当前站点未命中预设模块；你也可以手动点 114 / 115 / 116');
      return;
    }
    for (const id of ids) await injectModule(id);
  }

  function startAndReload(){
    const s = siteInfo();
    const ids = [];
    if (s.isXHS || s.isWeChat) ids.push('116');
    if (s.isImageHosts) ids.push('115');
    if (s.isMedia) ids.push('114');
    if (!ids.length) { log('当前站点没有自动刷新启动目标'); return; }
    sessionStorage.setItem(CFG.autoReloadKey, JSON.stringify(ids));
    log(`已标记刷新后自动启动：${ids.join(', ')}`);
    location.reload();
  }

  async function runAutoReload(){
    const raw = sessionStorage.getItem(CFG.autoReloadKey);
    if (!raw) return;
    sessionStorage.removeItem(CFG.autoReloadKey);
    let ids = [];
    try{ ids = JSON.parse(raw) || []; }catch{}
    if (!Array.isArray(ids) || !ids.length) return;
    log(`刷新后自动启动：${ids.join(', ')}`);
    for (const id of ids) await injectModule(id);
  }

  function togglePanel(force){
    const p = document.getElementById('__fusion_loader_panel__');
    if (!p) return;
    S.open = typeof force === 'boolean' ? force : !S.open;
    p.style.display = S.open ? 'block' : 'none';
    gmSet(CFG.openKey, S.open ? '1' : '0');
  }

  function hideShowLegacyPanels(){
    const nodes = Array.from(document.querySelectorAll('[id*="panel"], [class*="panel"], [id*="fab"], [id*="btn"], [class*="fab"]'))
      .filter(el => {
        const txt = ((el.textContent||'') + ' ' + (el.id||'') + ' ' + (el.className||'')).toLowerCase();
        return /xhs|fusion|media|bili|yt|ig|图床|tu\.ymawv|下载|提取/.test(txt);
      });
    let hidden = 0;
    for (const el of nodes) {
      if (el.id === '__fusion_loader_fab__' || el.id === '__fusion_loader_panel__') continue;
      el.style.display = (el.style.display === 'none') ? '' : 'none';
      hidden++;
    }
    log(`已切换旧浮窗显示状态，节点数：${hidden}`);
  }

  function makeUI(){
    if (S.uiReady) return;
    S.uiReady = true;
    addStyle(`
#__fusion_loader_fab__{position:fixed;right:14px;bottom:18px;z-index:2147483646;background:#111;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:10px 14px;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)}
#__fusion_loader_panel__{display:none;position:fixed;left:12px;right:12px;bottom:72px;z-index:2147483646;background:rgba(10,10,12,.96);backdrop-filter:blur(12px);color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px;box-shadow:0 12px 36px rgba(0,0,0,.4);font:14px/1.45 -apple-system,BlinkMacSystemFont,sans-serif}
#__fusion_loader_panel__ .row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}
#__fusion_loader_panel__ button{appearance:none;border:1px solid rgba(255,255,255,.12);background:#24262b;color:#fff;border-radius:12px;padding:12px 10px;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,sans-serif}
#__fusion_loader_panel__ .title{font-size:18px;font-weight:700;margin:0 0 8px}
#__fusion_loader_panel__ .sub{opacity:.82;font-size:12px;margin-bottom:8px}
#__fusion_loader_log__{width:100%;min-height:150px;max-height:260px;background:#050505;color:#d7f7d7;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;box-sizing:border-box;font:12px/1.5 ui-monospace,Menlo,monospace}
#__fusion_loader_urls__{width:100%;background:#111;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;font:12px/1.4 ui-monospace,monospace;box-sizing:border-box}
`);

    const fab = document.createElement('button');
    fab.id = '__fusion_loader_fab__';
    fab.textContent = 'Fusion Loader';
    fab.addEventListener('click', ()=>togglePanel());

    const panel = document.createElement('div');
    panel.id = '__fusion_loader_panel__';
    panel.innerHTML = `
      <div class="title">Fusion Loader</div>
      <div class="sub">主脚本只保留轻量外壳；114/115/116 从 GitHub Raw / jsDelivr 按需拉取执行。</div>
      <div class="row">
        <button id="fl_start_site">按当前站启动</button>
        <button id="fl_start_reload">启动并刷新</button>
      </div>
      <div class="row">
        <button id="fl_start_116">启动 116（XHS/公众号）</button>
        <button id="fl_start_115">启动 115（图床）</button>
      </div>
      <div class="row">
        <button id="fl_start_114">启动 114（B站/IG/YT）</button>
        <button id="fl_toggle_legacy">隐藏/显示旧浮窗</button>
      </div>
      <div class="row">
        <button id="fl_copy_log">复制日志</button>
        <button id="fl_close">收起</button>
      </div>
      <textarea id="__fusion_loader_log__" spellcheck="false" placeholder="日志输出区"></textarea>
    `;

    (document.body || document.documentElement).appendChild(panel);
    (document.body || document.documentElement).appendChild(fab);

    panel.querySelector('#fl_start_site').onclick = startCurrentSite;
    panel.querySelector('#fl_start_reload').onclick = startAndReload;
    panel.querySelector('#fl_start_116').onclick = ()=>injectModule('116');
    panel.querySelector('#fl_start_115').onclick = ()=>injectModule('115');
    panel.querySelector('#fl_start_114').onclick = ()=>injectModule('114');
    panel.querySelector('#fl_toggle_legacy').onclick = hideShowLegacyPanels;
    panel.querySelector('#fl_copy_log').onclick = ()=> window.GM_setClipboard((document.getElementById('__fusion_loader_log__')||{}).value || '');
    panel.querySelector('#fl_close').onclick = ()=>togglePanel(false);

    if (gmGet(CFG.openKey, '0') === '1') togglePanel(true);
    log('Loader UI 已就绪');
    runAutoReload();
  }

  function boot(){
    if (S.inited) return;
    S.inited = true;
    setupGMShim();
    try{
      const raw = gmGet(CFG.startedKey, '[]');
      const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      arr.forEach(x => S.started.add(String(x)));
    }catch{}
    domReady(()=> idle(makeUI));
  }

  boot();
})();
