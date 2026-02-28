// ==UserScript==
// @name         媒体工具面板（B站/IG/YT）合并版（iOS）
// @namespace    ios-userscripts
// @version      2.0.7
// @description  合并：B站 iOS 工具 + IG/网页 源码注水媒体提取；统一一个面板；YouTube：抓 playerResponse 并展示可直用URL；iOS Safari 兜底从 performance 资源抓 videoplayback 直链；生成 yt-dlp 命令（不提供解密 signatureCipher 的“硬解签”代码）。
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://m.bilibili.com/video/*
// @match        https://m.bilibili.com/bangumi/play/*
// @match        *://www.instagram.com/*
// @match        *://instagram.com/*
// @match        *://m.instagram.com/*
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://youtube.com/*
// @match        *://youtu.be/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==


(function () {
  'use strict';

/********************
 * GM_addStyle 兜底：某些 iOS Userscripts 环境可能没有 GM_addStyle
 ********************/
function __mt_addStyle(css){
  try{
    if (typeof GM_addStyle === 'function') return GM_addStyle(css);
  }catch(e){}
  try{
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }catch(e){
    try{ console.warn('[MT] addStyle failed', e); }catch{}
  }
}
window.__MT_addStyle = __mt_addStyle;

  /********************
   * 主面板（统一入口）
   ********************/
  const MT = {
    root: null,
    fab: null,
    tabs: {},
    pages: {},
    out: {},
    active: 'yt',
  };

  function $(sel, root=document) { return root.querySelector(sel); }
  function $all(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  function safeCall(fn, ...args){ try{ return fn && fn(...args);}catch(e){ console.warn('[MT]', e); } }

  // iOS Userscripts: document-start 早期可能没有 body/head；多保险触发一次
  function onReady(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try{ fn(); }catch(e){}
    } else {
      document.addEventListener('DOMContentLoaded', ()=>{ try{ fn(); }catch(e){} }, {once:true});
      window.addEventListener('load', ()=>{ try{ fn(); }catch(e){} }, {once:true});
    }
  }
  function copyText(text){
    if (typeof GM_setClipboard === 'function') {
      try { GM_setClipboard(text); return true; } catch {}
    }
    try { navigator.clipboard?.writeText?.(text); return true; } catch {}
    try {
      const ta=document.createElement('textarea');
      ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok=document.execCommand('copy'); document.body.removeChild(ta);
      return ok;
    } catch {}
    try { prompt('复制下面内容：', text); return true; } catch {}
    return false;
  }

  function toast(msg){
    const el = $('#mt-toast');
    if (!el) return;
    el.textContent = msg || '';
    el.style.opacity = '1';
    clearTimeout(el.__t);
    el.__t = setTimeout(()=>{ el.style.opacity='0.85'; }, 1200);
  }

  function waitBody(){
    if (document.body) return Promise.resolve();
    return new Promise(res=>{
      const done=()=>{ try{ mo&&mo.disconnect(); }catch(e){}; try{ clearInterval(t); }catch(e){}; res(); };
      const t=setInterval(()=>{ if (document.body) done(); }, 30);
      let mo=null;
      try{
        mo=new MutationObserver(()=>{ if (document.body) done(); });
        mo.observe(document.documentElement, {childList:true, subtree:true});
      }catch(e){}
    });
  }

  function ensureMasterUI(){
    if (MT.root) return;

    window.__MT_addStyle(`
      #mt-fab{
        position:fixed; right:12px; bottom:calc(96px + env(safe-area-inset-bottom)); z-index:9999999;
        background:rgba(255, 61, 92, .92); color:#fff;
        border:0; border-radius:12px; padding:10px 12px;
        font: 600 14px -apple-system, system-ui;
        box-shadow:0 10px 28px rgba(0,0,0,.28);
      }
      #mt-panel{
        position:fixed; left:10px; right:10px; bottom:calc(90px + env(safe-area-inset-bottom)); z-index:9999999;
        max-width: 860px; margin:0 auto;
        background: rgba(20,20,20,.92);
        color:#fff; border-radius:16px;
        box-shadow:0 16px 44px rgba(0,0,0,.38);
        backdrop-filter: blur(10px);
        display:none;
      }
      #mt-head{
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 10px 6px 10px;
        border-bottom:1px solid rgba(255,255,255,.10);
      }
      #mt-tabs{ display:flex; gap:8px; align-items:center; }
      #mt-tabs button{
        border:0; border-radius:999px; padding:8px 12px;
        background:rgba(255,255,255,.10);
        color:#fff; font-weight:700; font-size:13px;
      }
      #mt-tabs button.active{ background:#2b84ff; }
      #mt-tabs button.disabled{ opacity:.45; }
      #mt-actions{ display:flex; gap:8px; align-items:center; }
      #mt-actions button{
        border:0; border-radius:10px; padding:8px 10px;
        background:rgba(255,255,255,.10); color:#fff; font-weight:700;
      }
      #mt-body{ padding:10px; }
      .mt-page{ display:none; }
      .mt-page.active{ display:block; }
      #mt-toast{ opacity:.85; font-size:12px; padding:0 10px 10px 10px; }
      .mt-note{ opacity:.85; font-size:12px; line-height:1.35; margin-top:8px; white-space:pre-line; }
      .mt-hr{ height:1px; background:rgba(255,255,255,.10); margin:10px 0; }
      .mt-embed{ border-radius:12px; background:rgba(0,0,0,.18); padding:8px; }
      .mt-embed *{ max-width:100%; }
    `);

    const fab = document.createElement('button');
    fab.id='mt-fab';
    fab.textContent='媒体工具';
    fab.addEventListener('click', ()=>{
      const p = MT.root;
      p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
    });

    const panel = document.createElement('div');
    panel.id='mt-panel';
    panel.innerHTML = `
      <div id="mt-head">
        <div id="mt-tabs">
          <button data-tab="bili">B站</button>
          <button data-tab="ig">IG</button>
          <button data-tab="yt">YouTube</button>
        </div>
        <div id="mt-actions">
          <button id="mt-close">×</button>
        </div>
      </div>
      <div id="mt-body">
        <div class="mt-page" data-page="bili"></div>
        <div class="mt-page" data-page="ig"></div>
        <div class="mt-page" data-page="yt"></div>
        <div class="mt-note" id="mt-note"></div>
      </div>
      <div id="mt-toast">就绪</div>
    `;

    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(panel);

    MT.fab=fab;
    MT.root=panel;

    $('#mt-close').addEventListener('click', ()=>{ panel.style.display='none'; });

    // tab switch
    $all('#mt-tabs button', panel).forEach(b=>{
      b.addEventListener('click', ()=>{
        if (b.classList.contains('disabled')) return;
        setActive(b.getAttribute('data-tab'));
      });
    });

    MT.pages = {
      bili: panel.querySelector('.mt-page[data-page="bili"]'),
      ig: panel.querySelector('.mt-page[data-page="ig"]'),
      yt: panel.querySelector('.mt-page[data-page="yt"]'),
    };

    setActive('yt');
    refreshTabAvailability();
  }

  function setActive(key){
    MT.active=key;
    $all('#mt-tabs button', MT.root).forEach(b=>{
      b.classList.toggle('active', b.getAttribute('data-tab')===key);
    });
    Object.entries(MT.pages).forEach(([k,el])=>{
      el.classList.toggle('active', k===key);
    });
  }

  function refreshTabAvailability(){
    const host = location.hostname;
    const isBili = /(^|\.)bilibili\.com$/.test(host);
    const isIG = /(^|\.)instagram\.com$/.test(host);
    const isYT = /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host);

    const map = { bili:isBili, ig:isIG, yt:isYT };
    $all('#mt-tabs button', MT.root).forEach(b=>{
      const k=b.getAttribute('data-tab');
      const ok=!!map[k];
      b.classList.toggle('disabled', !ok);
    });

    const note = $('#mt-note');
    note.textContent =
      (isBili? '' : '当前页不是 B站：B站页才会加载 B站工具。\n') +
      (isIG? '' : '当前页不是 Instagram：IG页才会加载 IG工具。\n') +
      (isYT? '' : '当前页不是 YouTube：YT页才会加载 YT工具。\n') +
      '\n⚠️ 说明：YouTube 的 signatureCipher/Player.js “硬解签”属于绕过平台签名机制的行为，这里不提供该部分代码；面板只展示已可直用的 URL，并提供 yt-dlp 命令作为替代。';
  }

  // 供子脚本把自己的面板挂到主面板里
  window.__MT_attach = function(key, el){
    try{
      ensureMasterUI();
      const page = MT.pages[key];
      if (!page) return false;
      page.innerHTML='';
      page.appendChild(el);

      // 统一把“固定定位面板”改成嵌入式
      el.classList.add('mt-embed');
      el.style.position='static';
      el.style.right='auto';
      el.style.left='auto';
      el.style.bottom='auto';
      el.style.top='auto';
      el.style.width='auto';
      el.style.zIndex='auto';

      // B站脚本：隐藏它自己的“B站 iOS 工具”开关按钮，直接展开面板
      if (key==='bili'){
        const btn = el.querySelector('button');
        const panel = el.querySelector('div');
        if (btn) btn.style.display='none';
        if (panel) panel.style.display='block';
      }

      // IG脚本：把它的 textarea 高度放大一点
      if (key==='ig'){
        const ta = el.querySelector('textarea');
        if (ta) ta.style.height='140px';
      }

      toast(`已加载：${key}`);
      return true;
    }catch(e){
      console.warn('[MT_attach]', e);
      return false;
    }
  };

  // 尽早插入 UI
  onReady(()=>{ waitBody().then(()=>{ ensureMasterUI(); refreshTabAvailability(); }); });
/********************
   * YouTube 子模块（不做硬解签）
   ********************/
  (function ytModule(){
    const host = location.hostname;
    const isYT = /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host);
    if (!isYT) return;

    const S = {
      player: null,
      formats: [],
      capturedAt: 0,

      // 兜底：iOS Safari 上有时抓不到 playerResponse，但媒体请求会出现在 performance 资源列表里
      mediaMap: new Map(), // key=url -> {itag, mime, clen, dur, sig, c}
      perfObserver: null,
    };

    function qsToObj(qs){
      const o = {};
      const s = String(qs || '').replace(/^\?/, '');
      if (!s) return o;
      for (const part of s.split('&')) {
        if (!part) continue;
        const idx = part.indexOf('=');
        const k = idx >= 0 ? part.slice(0, idx) : part;
        const v = idx >= 0 ? part.slice(idx + 1) : '';
        try {
          o[decodeURIComponent(k)] = decodeURIComponent(v);
        } catch {
          o[k] = v;
        }
      }
      return o;
    }

function addMediaUrl(u){
  try{
    if (!u) return;
    const url = String(u);
    if (!/googlevideo\.com\/videoplayback/.test(url)) return;
    if (S.mediaMap.has(url)) return;

    const q = qsToObj(url.split('?')[1]||'');
    const itag = q.itag ? Number(q.itag) : null;
    const mime = q.mime ? decodeURIComponent(q.mime) : '';
    const clen = q.clen ? Number(q.clen) : null;
    const dur  = q.dur ? Number(q.dur) : null;
    const c    = q.c || '';
    const sig  = q.sig || q.lsig || '';

    S.mediaMap.set(url, { url, id: q.id || "", itag, mime, clen, dur, c, sig });
    renderBadges();
  }catch{}
}


  function inferItagById(id){
    if (!id) return '';
    const s = new Set();
    for (const m of S.mediaMap.values()){
      if (m && m.id === id && m.itag) s.add(String(m.itag));
    }
    return (s.size === 1) ? Array.from(s)[0] : '';
  }

function scanPerformance(){
  try{
    const list = performance.getEntriesByType('resource') || [];
    for (const e of list){
      const name = e && e.name;
      if (name) addMediaUrl(name);
    }
  }catch{}
}

function startPerfObserver(){
  // 尽量用 PerformanceObserver 实时抓；不支持就轮询扫描
  try{
    if (S.perfObserver) return;
    if (typeof PerformanceObserver === 'function'){
      const obs = new PerformanceObserver((list)=>{
        try{
          for (const e of list.getEntries()){
            if (e?.name) addMediaUrl(e.name);
          }
        }catch{}
      });
      obs.observe({ entryTypes: ['resource'] });
      S.perfObserver = obs;
    }
  }catch{}
  // 轮询兜底：每 600ms 扫一次，持续 30s
  let n = 0;
  const timer = setInterval(()=>{
    scanPerformance();
    n++;
    if (n > 50) clearInterval(timer);
  }, 600);
}

    // 兜底：拦截 <video>/<audio>/<source> 的 src/currentSrc（很多情况下比 Performance 更稳）
    function hookMediaSrc(){
      if (hookMediaSrc.__done) return;
      hookMediaSrc.__done = true;

      const safeAdd = (u)=>{
        try{
          if (!u) return;
          const s = String(u);
          if (!s) return;
          // 只收集 googlevideo/videoplayback & 看起来像媒体直链的
          if (/googlevideo\.com\/videoplayback/.test(s) || /\.(mp4|m4a|webm)(\?|$)/i.test(s)) addMediaUrl(s, 'media-src');
        }catch{}
      };

      // hook property setter: HTMLMediaElement.src
      try{
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (d && d.set && !d.set.__mt_hooked){
          Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            configurable: true,
            enumerable: d.enumerable,
            get: d.get,
            set: function(v){ safeAdd(v); return d.set.call(this, v); }
          });
          d.set.__mt_hooked = true;
        }
      }catch{}

      // hook HTMLSourceElement.src
      try{
        const d2 = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
        if (d2 && d2.set && !d2.set.__mt_hooked){
          Object.defineProperty(HTMLSourceElement.prototype, 'src', {
            configurable: true,
            enumerable: d2.enumerable,
            get: d2.get,
            set: function(v){ safeAdd(v); return d2.set.call(this, v); }
          });
          d2.set.__mt_hooked = true;
        }
      }catch{}

      // 事件：loadstart/loadedmetadata 时抓 currentSrc
      try{
        const handler = (e)=>{
          const t = e?.target;
          if (!t) return;
          if (t instanceof HTMLMediaElement){
            safeAdd(t.currentSrc);
            safeAdd(t.src);
          }
        };
        document.addEventListener('loadstart', handler, true);
        document.addEventListener('loadedmetadata', handler, true);
        document.addEventListener('loadeddata', handler, true);
      }catch{}

      // 定时扫一遍现有 media 元素
      setInterval(()=>{
        try{
          document.querySelectorAll('video,audio').forEach(el=>{
            safeAdd(el.currentSrc);
            safeAdd(el.src);
          });
        }catch{}
      }, 800);
    }


    function pickTitle(){
      const og=document.querySelector('meta[property="og:title"]')?.content;
      return og || document.title || 'youtube';
    }

    function getVideoId(){
      try{
        const u=new URL(location.href);
        return u.searchParams.get('v') || '';
      }catch{ return ''; }
    }

    function simplifyFormats(){
      const out = [];
      const arr = S.formats || [];
      for (const f of arr){
        out.push({
          itag: f.itag,
          mime: f.mimeType?.split(';')[0] || '',
          codecs: (f.mimeType||'').match(/codecs="([^"]+)"/)?.[1] || '',
          w: f.width, h: f.height, fps: f.fps,
          q: f.qualityLabel || f.audioQuality || '',
          bw: f.bitrate || f.averageBitrate || 0,
          clen: f.contentLength || '',
          url: f.url || '',
          cipher: f.signatureCipher || f.cipher || '',
        });
      }
      return out;
    }

    function updateFromPlayer(pr){
      S.player = pr;
      const sd = pr?.streamingData;
      const a = [];
      if (sd?.formats?.length) a.push(...sd.formats);
      if (sd?.adaptiveFormats?.length) a.push(...sd.adaptiveFormats);
      S.formats = a;
      S.capturedAt = Date.now();
      renderBadges();
    }

    function tryReadGlobal(){
      const pr = window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.player_response;
      if (pr && typeof pr === 'object' && pr.streamingData) return pr;
      if (typeof pr === 'string'){
        try{ const j=JSON.parse(pr); if (j.streamingData) return j; }catch{}
      }
      return null;
    }

    function hookNet(){
      const origFetch = window.fetch;
      if (typeof origFetch === 'function' && !origFetch.__mt_hooked){
        const f = async function(...args){
          const res = await origFetch.apply(this, args);
          try{
            const url = (args[0] && args[0].url) ? args[0].url : String(args[0]||'');
            // 兜底：如果是 videoplayback 直链，直接记下来（某些情况下不会走这里，但有用）
            if (/googlevideo\.com\/videoplayback/.test(url)) addMediaUrl(url);

            if (/youtubei\/v1\/player|\/player\?/.test(url)){
              const clone = res.clone();
              clone.text().then(t=>{
                try{
                  const j = JSON.parse(t);
                  if (j?.streamingData) updateFromPlayer(j);
                  if (j?.playerResponse?.streamingData) updateFromPlayer(j.playerResponse);
                }catch{}
              });
            }
          }catch{}
          return res;
        };
        f.__mt_hooked = true;
        window.fetch = f;
      }

      const XHR = XMLHttpRequest;
      if (XHR && !XHR.prototype.__mt_hooked){
        const oopen = XHR.prototype.open;
        const osend = XHR.prototype.send;
        XHR.prototype.open = function(method, url, ...rest){
          this.__mt_url = url;
          return oopen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function(body){
          this.addEventListener('load', function(){
            try{
              const url = String(this.__mt_url||'');
              // 兜底：如果是 videoplayback 直链，直接记下来（某些情况下不会走这里，但有用）
            if (/googlevideo\.com\/videoplayback/.test(url)) addMediaUrl(url);

            if (/youtubei\/v1\/player|\/player\?/.test(url)){
                const t = this.responseText;
                const j = JSON.parse(t);
                if (j?.streamingData) updateFromPlayer(j);
                if (j?.playerResponse?.streamingData) updateFromPlayer(j.playerResponse);
              }
            }catch{}
          });
          return osend.call(this, body);
        };
        XHR.prototype.__mt_hooked = true;
      }
    }

    
    function addResourceUrl(u){
      try{
        if (!u) return;
        if (!/googlevideo\.com\/videoplayback/.test(u)) return;
        if (S.resourceUrls.indexOf(u) === -1) S.resourceUrls.push(u);
      }catch(e){}
    }

    function parseGoogUrl(u){
      try{
        const U = new URL(u);
        const itag = U.searchParams.get('itag') || '';
        const mime = decodeURIComponent(U.searchParams.get('mime') || '');
        const clen = U.searchParams.get('clen') || '';
        const dur = U.searchParams.get('dur') || '';
        return {itag, mime, clen, dur, url:u};
      }catch(e){ return {itag:'', mime:'', clen:'', dur:'', url:u}; }
    }

    function startResourceWatch(){
      // 1) 先扫一次已有 performance entries
      try{
        const es = performance.getEntriesByType('resource') || [];
        es.forEach(e=>{ if (e && e.name) addResourceUrl(String(e.name)); });
      }catch(e){}

      // 2) 再监听后续资源（包含 video/audio 直链请求）
      try{
        const po = new PerformanceObserver((list)=>{
          try{
            list.getEntries().forEach(e=>{ if (e && e.name) addResourceUrl(String(e.name)); });
            renderBadges();
          }catch(e){}
        });
        po.observe({type:'resource', buffered:true});
        S.__po = po;
      }catch(e){}

      // 3) 保险：轮询一段时间（有些环境禁用 PerformanceObserver）
      let n=0;
      const t=setInterval(()=>{
        n++;
        try{
          const es = performance.getEntriesByType('resource') || [];
          es.forEach(e=>{ if (e && e.name) addResourceUrl(String(e.name)); });
          renderBadges();
        }catch(e){}
        if (n>=20) clearInterval(t);
      }, 800);
    }

    function renderBadges(){
      const id = getVideoId();
      const direct = (S.formats||[]).filter(x=>x.url).length + (S.mediaMap?.size||0);
      const cipher = (S.formats||[]).filter(x=>x.signatureCipher||x.cipher).length;
      const elId = $('#yt-id');
      const elFmt = $('#yt-fmt');
      const elAft = $('#yt-aft');
      if (elId) elId.textContent = `ID:${id||'?'}`;
      if (elFmt) elFmt.textContent = `fmt:${direct}`;
      if (elAft) elAft.textContent = `aft:${cipher}`;
    }

    function ensureYTUI(){
      ensureMasterUI();
      const page = MT.pages.yt;
      if (!page || page.__yt_ready) return;
      page.__yt_ready = true;

      const box = document.createElement('div');
      box.innerHTML = `
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
          <span style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.12);" id="yt-id">ID:?</span>
          <span style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.12);" id="yt-fmt">fmt:0</span>
          <span style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.12);" id="yt-aft">aft:0</span>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <button id="yt-copycmd" style="flex:1; padding:12px 10px; border-radius:12px; border:0; background:#2b84ff; color:#fff; font-weight:800;">复制 yt-dlp 命令</button>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <button id="yt-showurl" style="flex:1; padding:12px 10px; border-radius:12px; border:0; background:#3a3a3a; color:#fff;">显示可直用URL</button>
          <button id="yt-showcipher" style="flex:1; padding:12px 10px; border-radius:12px; border:0; background:#3a3a3a; color:#fff;">显示Cipher(需解签)</button>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <button id="yt-copypr" style="flex:1; padding:12px 10px; border-radius:12px; border:0; background:#4a4a4a; color:#fff;">复制 playerResponse JSON(精简)</button>
          <button id="yt-debug" style="flex:1; padding:12px 10px; border-radius:12px; border:0; background:#4a4a4a; color:#fff;">Debug</button>
        </div>

        <textarea id="yt-out" style="width:100%; height:160px; resize:none; border-radius:12px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.08); color:#fff; padding:10px; font-size:12px; line-height:1.35;" placeholder="这里会明文显示 URL / Cipher / 命令（可长按选中复制）"></textarea>

        <div class="mt-note" id="yt-hint">提示：如果还没抓到 playerResponse，请点一下播放 / 切换清晰度 / 刷新页面后再点。</div>
      `;
      page.innerHTML = '';
      page.appendChild(box);

      const out = $('#yt-out', box);

      $('#yt-copycmd', box).addEventListener('click', ()=>{
        const id = getVideoId();
        const title = pickTitle().replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
        const cmd = `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "${title}.%(ext)s" "https://www.youtube.com/watch?v=${id}"`;
        out.value = cmd;
        copyText(cmd);
        toast('已复制 yt-dlp 命令');
      });

      $('#yt-showurl', box).addEventListener('click', ()=>{
  // 1) 优先展示 playerResponse 里自带的直链
  const fs = simplifyFormats().filter(x=>x.url);

  // 2) 兜底：从 performance 资源里抓到的 videoplayback 直链（iOS Safari 常见）
  scanPerformance();
  const perfMetas = Array.from(S.mediaMap.values());

  if (!fs.length && !perfMetas.length){
          out.value = `还没有抓到可直用 URL，也没有抓到 signatureCipher。
请按这个顺序试：
1) 点一下播放（让视频真正开始加载）
2) 切一次清晰度（比如从 Auto 切到 1080p/4K）
3) 仍不行就刷新页面，再点一次“显示可直用URL”

备注：YouTube 的直链常在接口返回里，不一定在 HTML 里。`;
          return;
        }

  const parts = [];
  if (fs.length){
    parts.push('【playerResponse 直链】');
    parts.push(...fs.map(x=>`itag=${x.itag} ${x.w||0}x${x.h||0} ${x.fps||0}fps ${x.mime} ${x.q}
${x.url}`));
  }
  if (perfMetas.length){
    parts.push('【performance 资源直链】');
    // 尝试按 itag 分组/排序（没有 itag 的放后面）
    const items = perfMetas.map(m=>{
      const rawItag = m.itag ? Number(m.itag) : NaN;
      let itagNum = Number.isFinite(rawItag) ? rawItag : NaN;
      let inferred = false;
      if (!Number.isFinite(itagNum) && m.id){
        const inf = inferItagById(m.id);
        if (inf){
          itagNum = Number(inf);
          inferred = true;
        }
      }
      return { meta: m, itagNum: Number.isFinite(itagNum) ? itagNum : 999999, inferred };
    }).sort((a,b)=>a.itagNum-b.itagNum);

    parts.push(...items.map(x=>{
      const m = x.meta;
      const tag = (x.itagNum===999999) ? 'itag=?' : (`itag=${x.itagNum}` + (x.inferred && !m.itag ? ' (推断)' : ''));
      const extra = [m.mime?`mime=${m.mime}`:'', m.id?`id=${m.id}`:''].filter(Boolean).join(' ');
      return `${tag}${extra?(' '+extra):''}
${m.url}`;
    }));
  }

  out.value = parts.join('\n\n');
  toast(`已显示 ${fs.length + items.length} 条可直用URL（含兜底抓取）`);
});

      $('#yt-showcipher', box).addEventListener('click', ()=>{
        const fs = simplifyFormats().filter(x=>x.cipher);
        if (!fs.length){ out.value = '没有发现 signatureCipher/cipher'; return; }
        const lines = fs.map(x=>`itag=${x.itag} ${x.w||0}x${x.h||0} ${x.fps||0}fps ${x.mime} ${x.q}\n${x.cipher}`);
        out.value = lines.join('\n\n');
        toast(`已显示 ${fs.length} 条 Cipher`);
      });

      $('#yt-copypr', box).addEventListener('click', ()=>{
        const pr = S.player;
        if (!pr){ out.value='还没捕获到 playerResponse'; return; }
        const mini = {
          videoDetails: pr.videoDetails ? {
            videoId: pr.videoDetails.videoId,
            title: pr.videoDetails.title,
            author: pr.videoDetails.author,
            lengthSeconds: pr.videoDetails.lengthSeconds,
            shortDescription: (pr.videoDetails.shortDescription||'').slice(0, 2000),
          } : undefined,
          streamingData: { formats: simplifyFormats() },
        };
        const txt = JSON.stringify(mini, null, 2);
        out.value = txt;
        copyText(txt);
        toast('已复制 playerResponse(精简)');
      });

      $('#yt-debug', box).addEventListener('click', ()=>{
        const id=getVideoId();
        const pr=!!S.player;
        const fs=S.formats?.length||0;
        out.value = [
          `url: ${location.href}`,
          `videoId: ${id}`,
          `playerResponse: ${pr ? 'YES' : 'NO'}`,
          `formats total: ${fs}`,
          `direct url: ${(S.formats||[]).filter(x=>x.url).length}`,
          `cipher: ${(S.formats||[]).filter(x=>x.signatureCipher||x.cipher).length}`,
          '',
          `⚠️ 本脚本不包含 YouTube signatureCipher 的“硬解签”(抓 player.js + 解析解密函数)。`
        ].join('\n');
        toast('Debug 已输出');
      });

      renderBadges();
    }

    hookNet();
    /*startResourceWatch();*/
    ensureYTUI();
    startPerfObserver();
    hookMediaSrc();

    // 轮询一次：很多时候 ytInitialPlayerResponse 在稍后才出现
    const t = setInterval(()=>{
      const pr = tryReadGlobal();
      if (pr && pr.streamingData){
        updateFromPlayer(pr);
        clearInterval(t);
        toast('已捕获 ytInitialPlayerResponse');
      }
    }, 250);

    setTimeout(()=>clearInterval(t), 15000);
  })();

})(); // master IIFE end


/* ===== IG 模块（原脚本，已挂到主面板） ===== */
(function () {
  'use strict';


  const __MT_HOST = location.hostname;
  if (!/(^|\.)instagram\.com$/.test(__MT_HOST)) return;

  /********************
   * 全局状态
   ********************/
  const S = {
    routeKey: '',
    seqVideo: 1,
    seqImg: 1,
    videos: new Map(),
    images: new Map(),
    author: '',
    title: '',
    bestRes: '',
    lastSeenJsonAt: 0,
    lastError: '',
  };

  const CFG = {
    ui: true,
    maxTitleLen: 80,
    maxAuthorLen: 40,
    fileNameMaxLen: 140,
    preferHighest: true,
    defaultFolderName: 'Downloads_IG',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Referer': 'https://www.instagram.com/',
      'Origin': 'https://www.instagram.com',
    },
  };

  /********************
   * 工具函数
   ********************/
  function now() { return Date.now(); }
  function isHttpUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }
  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

  function uniqPushMap(map, item) {
    if (!item || !item.url) return;
    if (!map.has(item.url)) map.set(item.url, item);
    else {
      const old = map.get(item.url);
      if ((item.score || 0) > (old.score || 0)) map.set(item.url, item);
    }
  }

  function getExtFromUrl(url) {
    try {
      const u = new URL(url);
      const p = u.pathname || '';
      const m = p.match(/\.([a-z0-9]{2,5})$/i);
      if (m) return m[1].toLowerCase();
      const fmt = u.searchParams.get('format') || u.searchParams.get('fm');
      if (fmt) return String(fmt).toLowerCase().replace('jpeg', 'jpg');
      return '';
    } catch {
      const m = String(url).match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
      return m ? m[1].toLowerCase() : '';
    }
  }

  function stripEmojis(s) {
    return String(s || '')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '');
  }

  function sanitizeName(s, maxLen) {
    s = stripEmojis(s || '').trim();
    s = s.replace(/\s+on\s+instagram\s*:?\s*/i, ' ').trim();
    s = s.replace(/[“”"]/g, '').trim();
    s = s.replace(/[\\\/:*?"<>|]/g, '_');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).trim();
    return s || 'untitled';
  }

  function pad2(n) { return String(Number(n) || 0).padStart(2, '0'); }

  function pickBest(map) {
    const arr = [...map.values()];
    if (!arr.length) return null;
    arr.sort((a, b) => (b.score || 0) - (a.score || 0));
    return arr[0];
  }

  function pickAllSorted(map) {
    const arr = [...map.values()];
    arr.sort((a, b) => (b.score || 0) - (a.score || 0));
    return arr;
  }

  function inferRes(item) {
    if (!item) return '';
    const w = item.width || 0;
    const h = item.height || 0;
    if (w > 0 && h > 0) return `${w}x${h}`;
    try {
      const u = new URL(item.url);
      const ww = parseInt(u.searchParams.get('w') || u.searchParams.get('width') || '0', 10);
      const hh = parseInt(u.searchParams.get('h') || u.searchParams.get('height') || '0', 10);
      if (ww > 0 && hh > 0) return `${ww}x${hh}`;
    } catch {}
    return '';
  }

  function updateBestRes() {
    const bv = pickBest(S.videos);
    const bi = pickBest(S.images);
    const r1 = inferRes(bv);
    const r2 = inferRes(bi);
    S.bestRes = r1 || r2 || S.bestRes || 'unknown';
  }

  function getMeta(nameOrProp) {
    const sel1 = document.querySelector(`meta[property="${nameOrProp}"]`);
    if (sel1 && sel1.content) return sel1.content;
    const sel2 = document.querySelector(`meta[name="${nameOrProp}"]`);
    if (sel2 && sel2.content) return sel2.content;
    return '';
  }

  function refreshAuthorTitleFromDom() {
    const ogTitle = getMeta('og:title') || getMeta('twitter:title') || document.title || '';
    let author = '';
    let title = '';

    const m1 = ogTitle.match(/^(.+?)\s+on\s+instagram/i);
    const m2 = ogTitle.match(/^(.+?)\s+•\s+instagram/i);
    if (m1) author = m1[1];
    else if (m2) author = m2[1];

    const desc = getMeta('og:description') || getMeta('twitter:description') || '';
    title = desc || ogTitle;

    author = sanitizeName(author || '', CFG.maxAuthorLen);
    title = sanitizeName(title || '', CFG.maxTitleLen);

    // IG iOS web 有时 header 不好取，改为更稳的兜底：从页面里找“蓝V账号名”区域
    if (!author || author === 'untitled') {
      const a = document.querySelector('header a[href^="/"][role="link"], a[href^="/"][role="link"]');
      if (a && a.textContent) author = sanitizeName(a.textContent, CFG.maxAuthorLen);
    }

    S.author = author && author !== 'untitled' ? author : (S.author || 'unknown_author');
    S.title = title && title !== 'untitled' ? title : (S.title || 'untitled');
  }

  function buildFileName(kind, item, seq) {
    refreshAuthorTitleFromDom();
    const res = inferRes(item) || S.bestRes || 'unknown';
    const author = sanitizeName(S.author, CFG.maxAuthorLen);
    const title = sanitizeName(S.title, CFG.maxTitleLen);

    let ext = (item && item.ext) || getExtFromUrl(item && item.url) || '';
    if (!ext) ext = (kind === 'video' ? 'mp4' : 'jpg');
    if (ext === 'jpeg') ext = 'jpg';

    const base = `${author}_${title}_${res}_${pad2(seq)}`;
    let fn = `${base}.${ext}`;

    if (fn.length > CFG.fileNameMaxLen) {
      const over = fn.length - CFG.fileNameMaxLen;
      const newTitleLen = Math.max(10, title.length - over);
      const title2 = sanitizeName(S.title, newTitleLen);
      fn = `${author}_${title2}_${res}_${pad2(seq)}.${ext}`;
      if (fn.length > CFG.fileNameMaxLen) fn = fn.slice(0, CFG.fileNameMaxLen);
    }
    return fn;
  }

  function q(s) {
    s = String(s).replace(/(["\\$`])/g, '\\$1');
    return `"${s}"`;
  }

  function buildCurlCmd(url, outName) {
    const H = CFG.headers;
    const headers = [
      `-H ${q(`User-Agent: ${H['User-Agent']}`)}`,
      `-H ${q(`Referer: ${H['Referer']}`)}`,
      `-H ${q(`Origin: ${H['Origin']}`)}`
    ].join(' ');
    return `curl -L ${headers} -o ${q(outName)} ${q(url)}`;
  }

  function buildAria2Cmd(url, outName) {
    const H = CFG.headers;
    const headers = [
      `--header=${q(`User-Agent: ${H['User-Agent']}`)}`,
      `--header=${q(`Referer: ${H['Referer']}`)}`,
      `--header=${q(`Origin: ${H['Origin']}`)}`
    ].join(' ');
    return `aria2c -c -x 8 -s 8 ${headers} -o ${q(outName)} ${q(url)}`;
  }

  function buildBatchCmd(kind, items) {
    const folder = CFG.defaultFolderName;
    const lines = [];
    lines.push(`mkdir -p ${q(folder)}`);
    lines.push(`cd ${q(folder)}`);

    if (kind === 'video') {
      const it = items[0];
      const fn = buildFileName('video', it, S.seqVideo);
      lines.push(buildCurlCmd(it.url, fn));
      lines.push(`# aria2c(可选)：`);
      lines.push(`# ${buildAria2Cmd(it.url, fn)}`);
    } else {
      items.forEach((it, idx) => {
        const seq = S.seqImg + idx;
        const fn = buildFileName('image', it, seq);
        lines.push(buildCurlCmd(it.url, fn));
      });
      lines.push(`# aria2c 批量(可选)：`);
      items.forEach((it, idx) => {
        const seq = S.seqImg + idx;
        const fn = buildFileName('image', it, seq);
        lines.push(`# ${buildAria2Cmd(it.url, fn)}`);
      });
    }
    return lines.join('\n');
  }

  function resetOnRouteChange() {
    const key = location.origin + location.pathname;
    if (key !== S.routeKey) {
      S.routeKey = key;
      S.seqVideo = 1;
      S.seqImg = 1;
      S.videos.clear();
      S.images.clear();
      S.bestRes = '';
      S.lastError = '';
      setTimeout(() => {
        refreshAuthorTitleFromDom();
        scanDomForMedia();
        updateBestRes();
        renderUI();
      }, 700);
    }
  }

  /********************
   * JSON 深度扫描
   ********************/
  function scoreByWH(w, h) { return (Number(w) || 0) * (Number(h) || 0); }

  function addVideo(url, w, h, source) {
    if (!isHttpUrl(url)) return;
    const ext = getExtFromUrl(url) || 'mp4';
    uniqPushMap(S.videos, {
      url, width: w || 0, height: h || 0, ext,
      score: scoreByWH(w, h) + 10_000_000,
      source: source || 'json'
    });
  }

  function addImage(url, w, h, source) {
    if (!isHttpUrl(url)) return;
    let ext = getExtFromUrl(url) || 'jpg';
    if (ext === 'jpeg') ext = 'jpg';
    uniqPushMap(S.images, {
      url, width: w || 0, height: h || 0, ext,
      score: scoreByWH(w, h),
      source: source || 'json'
    });
  }

  function deepScan(obj, sourceTag) {
    const seen = new WeakSet();
    function walk(x) {
      if (!x || typeof x !== 'object') return;
      if (seen.has(x)) return;
      seen.add(x);

      if (Array.isArray(x)) { for (const it of x) walk(it); return; }

      if (typeof x.video_url === 'string') addVideo(x.video_url, x.width, x.height, sourceTag);
      if (typeof x.display_url === 'string') addImage(x.display_url, x.dimensions?.width, x.dimensions?.height, sourceTag);

      if (Array.isArray(x.video_versions)) {
        for (const v of x.video_versions) if (v && typeof v.url === 'string') addVideo(v.url, v.width, v.height, sourceTag);
      }
      if (x.image_versions2 && Array.isArray(x.image_versions2.candidates)) {
        for (const c of x.image_versions2.candidates) if (c && typeof c.url === 'string') addImage(c.url, c.width, c.height, sourceTag);
      }
      if (Array.isArray(x.candidates)) {
        for (const c of x.candidates) {
          if (c && typeof c.url === 'string') {
            if (/\.mp4(\?|$)/i.test(c.url)) addVideo(c.url, c.width, c.height, sourceTag);
            else addImage(c.url, c.width, c.height, sourceTag);
          }
        }
      }

      if (x.owner && typeof x.owner.username === 'string' && !S.author) S.author = sanitizeName(x.owner.username, CFG.maxAuthorLen);
      if (typeof x.username === 'string' && !S.author) S.author = sanitizeName(x.username, CFG.maxAuthorLen);
      if (x.caption && typeof x.caption.text === 'string' && (!S.title || S.title === 'untitled')) S.title = sanitizeName(x.caption.text, CFG.maxTitleLen);

      for (const k of Object.keys(x)) walk(x[k]);
    }

    try { walk(obj); } catch {}
    updateBestRes();
    renderUI();
  }

  /********************
   * DOM 扫描
   ********************/
  function scanDomForMedia() {
    try {
      refreshAuthorTitleFromDom();

      const ogv = getMeta('og:video') || getMeta('og:video:url') || '';
      if (ogv) addVideo(ogv, 0, 0, 'meta');
      const ogi = getMeta('og:image') || getMeta('og:image:url') || '';
      if (ogi) addImage(ogi, 0, 0, 'meta');

      for (const v of [...document.querySelectorAll('video')]) {
        const src = v.currentSrc || v.src;
        if (src && isHttpUrl(src)) addVideo(src, v.videoWidth || 0, v.videoHeight || 0, 'videoTag');
      }
      for (const im of [...document.querySelectorAll('img')]) {
        const src = im.currentSrc || im.src;
        if (src && isHttpUrl(src)) addImage(src, im.naturalWidth || 0, im.naturalHeight || 0, 'imgTag');
      }

      const scripts = [...document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]')];
      for (const sc of scripts) {
        const txt = (sc.textContent || '').trim();
        if (!txt || txt.length < 20) continue;
        const j = safeJsonParse(txt);
        if (j) deepScan(j, 'inlineScript');
      }

      updateBestRes();
    } catch {}
  }

  /********************
   * fetch/XHR Hook
   ********************/
  function injectHook() {
    const code = function () {
      try {
        const _fetch = window.fetch;
        window.fetch = async function (...args) {
          const res = await _fetch.apply(this, args);
          try {
            const cloned = res.clone();
            const ct = (cloned.headers.get('content-type') || '').toLowerCase();
            const url = String(cloned.url || '');
            if (ct.includes('application/json') || url.includes('graphql') || url.includes('/api/')) {
              cloned.text().then(t => {
                window.postMessage({ __TM_MEDIA_HIT__: 1, kind: 'fetch', url, text: t.slice(0, 5_000_000) }, '*');
              }).catch(()=>{});
            }
          } catch {}
          return res;
        };

        const _open = XMLHttpRequest.prototype.open;
        const _send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__tm_url__ = url;
          return _open.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
          this.addEventListener('load', function () {
            try {
              const url = String(this.__tm_url__ || '');
              const ct = String(this.getResponseHeader('content-type') || '').toLowerCase();
              if (ct.includes('application/json') || url.includes('graphql') || url.includes('/api/')) {
                const txt = this.responseText;
                window.postMessage({ __TM_MEDIA_HIT__: 1, kind: 'xhr', url, text: (txt || '').slice(0, 5_000_000) }, '*');
              }
            } catch {}
          });
          return _send.apply(this, args);
        };
      } catch {}
    };

    const s = document.createElement('script');
    s.textContent = `(${code.toString()})();`;
    document.documentElement.appendChild(s);
    s.remove();
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || !d.__TM_MEDIA_HIT__) return;
    S.lastSeenJsonAt = now();
    const j = safeJsonParse(d.text);
    if (j) deepScan(j, d.kind || 'net');
  });

  /********************
   * UI + 强复制兜底 + 明文显示
   ********************/
  const UI = {
    root: null,
    btnVideo: null,
    btnImgs: null,
    btnCmdV: null,
    btnCmdI: null,
    btnDbg: null,
    btnCopyOut: null,
    out: null,
    info: null,
    small: null,
  };

  function setOutput(text) {
    if (UI.out) {
      UI.out.value = text || '';
      UI.out.scrollTop = 0;
    }
  }

  function hardCopy(text) {
    // 1) Userscripts 剪贴板
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return true;
      }
    } catch {}

    // 2) navigator.clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    // 3) textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}

    // 4) 最终兜底：弹 prompt（你长按复制即可）
    try {
      prompt('复制下面内容：', text);
      return true;
    } catch {}

    return false;
  }

  function toast(msg) {
    const el = UI.info;
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.style.opacity = '0.85'; }, 1200);
  }

  function ensureUI() {
    if (!CFG.ui || UI.root) return;

    window.__MT_addStyle(`
      #tm-media-panel{
        position:fixed; right:10px; bottom:88px; z-index:999999;
        background:rgba(0,0,0,.72); color:#fff; font-size:12px;
        border-radius:12px; padding:10px; width:240px;
        box-shadow:0 10px 30px rgba(0,0,0,.25);
        backdrop-filter: blur(8px);
      }
      #tm-media-panel .row{ display:flex; gap:8px; margin:6px 0; }
      #tm-media-panel button{
        flex:1; border:0; border-radius:10px; padding:8px 8px;
        background:#2b7cff; color:#fff; font-weight:600;
      }
      #tm-media-panel button.secondary{ background:#555; }
      #tm-media-panel button.warn{ background:#ff7a2b; }
      #tm-media-panel button:disabled{ opacity:.5; }
      #tm-media-panel .meta{ opacity:.9; line-height:1.25; }
      #tm-media-panel .info{ margin-top:6px; opacity:.85; font-size:11px; }
      #tm-media-panel .small{ font-size:11px; opacity:.9; white-space:pre-line; }
      #tm-media-panel .badge{ display:inline-block; padding:1px 6px; border-radius:999px; background:rgba(255,255,255,.14); margin-right:6px; }
      #tm-out{
        width:100%; height:92px; resize:none; border-radius:10px;
        border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.08);
        color:#fff; padding:8px; outline:none;
        font-size:11px; line-height:1.25;
      }
    `);

    const root = document.createElement('div');
    root.id = 'tm-media-panel';
    root.innerHTML = `
      <div class="meta">
        <span class="badge" id="tm-bv">V:0</span>
        <span class="badge" id="tm-bi">I:0</span>
        <span class="badge" id="tm-br">Res:?</span>
      </div>

      <div class="row">
        <button id="tm-btn-video">显示/复制视频直链</button>
        <button id="tm-btn-imgs" class="secondary">显示/复制图片直链</button>
      </div>

      <div class="row">
        <button id="tm-btn-cmdv" class="warn">显示/复制a-Shell命令(视频)</button>
      </div>

      <div class="row">
        <button id="tm-btn-cmdi" class="warn">显示/复制a-Shell命令(图片批量)</button>
      </div>

      <textarea id="tm-out" placeholder="这里会明文显示URL/命令（可长按选中复制）"></textarea>

      <div class="row">
        <button id="tm-btn-copyout" class="secondary">复制上面输出</button>
        <button id="tm-btn-dbg" class="secondary">Debug</button>
      </div>

      <div class="info" id="tm-info">就绪</div>
      <div class="small" id="tm-small"></div>
    `;
    if (window.__MT_attach && window.__MT_attach('ig', root)) {
      // attached to master panel
    } else {
      document.documentElement.appendChild(root);
    }

    UI.root = root;
    UI.btnVideo = root.querySelector('#tm-btn-video');
    UI.btnImgs = root.querySelector('#tm-btn-imgs');
    UI.btnCmdV = root.querySelector('#tm-btn-cmdv');
    UI.btnCmdI = root.querySelector('#tm-btn-cmdi');
    UI.btnDbg = root.querySelector('#tm-btn-dbg');
    UI.btnCopyOut = root.querySelector('#tm-btn-copyout');
    UI.out = root.querySelector('#tm-out');
    UI.info = root.querySelector('#tm-info');
    UI.small = root.querySelector('#tm-small');

    UI.btnCopyOut.onclick = () => {
      const t = UI.out?.value || '';
      if (!t) return toast('输出为空');
      hardCopy(t);
      toast('已复制输出（如仍为空，长按上框复制）');
    };

    UI.btnVideo.onclick = () => {
      const best = pickBest(S.videos);
      if (!best) return toast('未抓到视频');
      const fn = buildFileName('video', best, S.seqVideo);
      const text = `${best.url}\n\n# 文件名：${fn}\n# 分辨率：${inferRes(best) || S.bestRes}`;
      setOutput(text);
      hardCopy(text);
      toast('已显示并尝试复制（如粘贴空，长按上框复制）');
      S.seqVideo += 1;
      renderUI();
    };

    UI.btnImgs.onclick = () => {
      const arr = pickAllSorted(S.images);
      if (!arr.length) return toast('未抓到图片');
      const lines = [];
      arr.forEach((it, idx) => {
        const seq = S.seqImg + idx;
        const fn = buildFileName('image', it, seq);
        lines.push(`${it.url}  # ${fn}  (${inferRes(it) || 'unknown'})`);
      });
      const text = lines.join('\n');
      setOutput(text);
      hardCopy(text);
      toast('已显示并尝试复制（如粘贴空，长按上框复制）');
      S.seqImg += arr.length;
      renderUI();
    };

    UI.btnCmdV.onclick = () => {
      const best = pickBest(S.videos);
      if (!best) return toast('未抓到视频');
      const cmd = buildBatchCmd('video', [best]);
      setOutput(cmd);
      hardCopy(cmd);
      toast('已显示并尝试复制（如粘贴空，长按上框复制）');
      S.seqVideo += 1;
      renderUI();
    };

    UI.btnCmdI.onclick = () => {
      const arr = pickAllSorted(S.images);
      if (!arr.length) return toast('未抓到图片');
      const cmd = buildBatchCmd('image', arr);
      setOutput(cmd);
      hardCopy(cmd);
      toast('已显示并尝试复制（如粘贴空，长按上框复制）');
      S.seqImg += arr.length;
      renderUI();
    };

    UI.btnDbg.onclick = () => {
      const bestV = pickBest(S.videos);
      const bestI = pickBest(S.images);
      const dbg = [
        `route: ${S.routeKey}`,
        `author: ${S.author}`,
        `title: ${S.title}`,
        `bestRes: ${S.bestRes}`,
        `videos: ${S.videos.size}`,
        bestV ? `bestVideo: ${bestV.url} (${inferRes(bestV) || 'unknown'}) [${bestV.source}]` : `bestVideo: none`,
        `images: ${S.images.size}`,
        bestI ? `bestImage: ${bestI.url} (${inferRes(bestI) || 'unknown'}) [${bestI.source}]` : `bestImage: none`,
        `lastSeenJson: ${S.lastSeenJsonAt ? new Date(S.lastSeenJsonAt).toLocaleString() : 'none'}`,
        S.lastError ? `lastError: ${S.lastError}` : ''
      ].filter(Boolean).join('\n');
      setOutput(dbg);
      hardCopy(dbg);
      toast('已显示Debug并尝试复制');
    };
  }

  function renderUI() {
    if (!CFG.ui || !UI.root) return;

    const bestV = pickBest(S.videos);
    const bestI = pickBest(S.images);
    updateBestRes();

    const bv = UI.root.querySelector('#tm-bv');
    const bi = UI.root.querySelector('#tm-bi');
    const br = UI.root.querySelector('#tm-br');
    if (bv) bv.textContent = `V:${S.videos.size}`;
    if (bi) bi.textContent = `I:${S.images.size}`;
    if (br) br.textContent = `Res:${S.bestRes || '?'}`;

    UI.btnVideo.disabled = !bestV;
    UI.btnCmdV.disabled = !bestV;
    UI.btnImgs.disabled = !bestI;
    UI.btnCmdI.disabled = !bestI;

    const small = [];
    small.push(`${sanitizeName(S.author || 'unknown', 24)} · ${sanitizeName(S.title || 'untitled', 36)}`);
    if (bestV) small.push(`Video: ${inferRes(bestV) || 'unknown'}  #${pad2(S.seqVideo)}`);
    if (bestI) small.push(`Imgs: ${S.images.size}  next#${pad2(S.seqImg)}`);
    UI.small.textContent = small.join('\n');
  }

  /********************
   * 路由监听（SPA）
   ********************/
  function hookHistory() {
    const _ps = history.pushState;
    const _rs = history.replaceState;
    history.pushState = function () { const r = _ps.apply(this, arguments); setTimeout(resetOnRouteChange, 60); return r; };
    history.replaceState = function () { const r = _rs.apply(this, arguments); setTimeout(resetOnRouteChange, 60); return r; };
    window.addEventListener('popstate', () => setTimeout(resetOnRouteChange, 60));
  }

  /********************
   * 启动
   ********************/
  function boot() {
    try {
      hookHistory();
      injectHook();

      const t = setInterval(() => {
        if (document.documentElement) {
          clearInterval(t);
          ensureUI();
          resetOnRouteChange();
          setInterval(() => {
            try {
              resetOnRouteChange();
              scanDomForMedia();
              renderUI();
            } catch {}
          }, 1500);
        }
      }, 50);
    } catch {}
  }

  boot();
})();


/* ===== B站 模块（原脚本，已挂到主面板） ===== */
(function () {
  'use strict';


  const __MT_HOST = location.hostname;
  if (!/(^|\.)bilibili\.com$/.test(__MT_HOST)) return;

  /********************
   * 基础工具
   ********************/
  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function stripEmoji(s = '') {
    // 去掉大部分 emoji/代理对字符（保守）
    return String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  }

  function sanitizeFileName(s = '') {
    s = stripEmoji(String(s));
    s = s.replace(/[\/\\:\*\?"<>\|\r\n]/g, '_');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[. ]+$/g, '');
    if (s.length > 120) s = s.slice(0, 120).trim();
    return s || 'bilibili';
  }

  async function copyText(txt) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(txt, 'text');
        return true;
      }
    } catch (e) { }
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch (e) { }
    prompt('复制下面文本：', txt);
    return false;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      position: fixed; left: 50%; bottom: 18%;
      transform: translateX(-50%);
      background: rgba(0,0,0,.78); color: #fff;
      padding: 10px 12px; border-radius: 10px;
      font-size: 14px; z-index: 999999;
      max-width: 85%; text-align: center;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function pickBestBy(arr, scoreFn) {
    let best = null;
    let bestScore = null;
    for (const it of (arr || [])) {
      const sc = scoreFn(it);
      if (bestScore === null || sc > bestScore) {
        best = it;
        bestScore = sc;
      }
    }
    return best;
  }

  function parseFrameRate(fr) {
    if (!fr) return 0;
    const s = String(fr);
    if (s.includes('/')) {
      const [a, b] = s.split('/').map(Number);
      if (!isFinite(a) || !isFinite(b) || b === 0) return 0;
      return a / b;
    }
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function parseBwFromUrl(u) {
    try {
      const url = new URL(u);
      const bw = url.searchParams.get('bw');
      return bw ? Number(bw) : 0;
    } catch (e) { return 0; }
  }

  function pickUrl(obj) {
    return obj?.baseUrl || obj?.base_url ||
      (obj?.backupUrl && obj.backupUrl[0]) ||
      (obj?.backup_url && obj.backup_url[0]) ||
      obj?.url || '';
  }

  function getBw(track) {
    const bw = Number(track?.bandwidth ?? track?.bandWidth ?? track?.bw);
    if (isFinite(bw) && bw > 0) return bw;
    const u = pickUrl(track);
    return parseBwFromUrl(u) || 0;
  }

  /********************
   * 质量选择逻辑：优先更高 qn / 分辨率 / 帧率 / 编码 / 带宽
   ********************/
  // B站常见清晰度 qn：127 8K, 126 DV, 125 HDR, 120 4K, 116 1080P60, 112 1080P+, 80 1080P, 74 720P60...
  const QN_TRY_LIST = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16];
  const qnRankMap = new Map(QN_TRY_LIST.map((q, i) => [q, (QN_TRY_LIST.length - i)]));

  function codecRank(codecid) {
    // 经验排序：AV1(13) > HEVC(12) > AVC(7)
    const m = { 13: 3, 12: 2, 7: 1 };
    return m[Number(codecid)] || 0;
  }

  function scoreDashVideo(v) {
    const qn = Number(v?.id) || 0;
    const qnScore = (qnRankMap.get(qn) || 0) * 1e12;
    const resScore = (Number(v?.height) || 0) * 1e8 + (Number(v?.width) || 0) * 1e6;
    const fpsScore = parseFrameRate(v?.frame_rate || v?.framerate) * 1e5;
    const codecScore = codecRank(v?.codecid) * 1e4;
    const bwScore = getBw(v);
    return qnScore + resScore + fpsScore + codecScore + bwScore;
  }

  function scoreDashAudio(a) {
    return getBw(a);
  }

  function chosenLabelFromQn(qn) {
    qn = Number(qn) || 0;
    if (qn === 127) return '8K';
    if (qn === 126) return 'DolbyVision';
    if (qn === 125) return 'HDR';
    if (qn === 120) return '4K';
    if (qn === 116) return '1080P60';
    if (qn === 112) return '1080P+';
    if (qn === 80) return '1080P';
    if (qn === 74) return '720P60';
    if (qn === 64) return '720P';
    return `QN${qn || '?'}`;
  }

  /********************
   * 页面信息获取（bvid/cid/ep_id/title）
   ********************/
  function getBvidFromUrl() {
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : '';
  }
  function getEpIdFromUrl() {
    const m = location.pathname.match(/\/bangumi\/play\/ep(\d+)/);
    return m ? Number(m[1]) : null;
  }
  function getSeasonIdFromUrl() {
    const m = location.pathname.match(/\/bangumi\/play\/ss(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function guessTitle() {
    let t = document.title || '';
    t = t.replace(/_哔哩哔哩.*$/i, '').trim();
    if (!t) {
      const og = $('meta[property="og:title"]')?.getAttribute('content') || '';
      t = og.trim();
    }
    return t || 'bilibili';
  }

  async function fetchJson(url, withCookies = true) {
    const r = await fetch(url, { credentials: withCookies ? 'include' : 'omit' });
    return await r.json();
  }

  async function fetchSeasonByEpOrSs({ ep_id, season_id }) {
    const urls = [];
    if (ep_id) urls.push(`https://api.bilibili.com/pgc/view/web/season?ep_id=${ep_id}`);
    if (season_id) urls.push(`https://api.bilibili.com/pgc/view/web/season?season_id=${season_id}`);
    for (const u of urls) {
      try {
        const j = await fetchJson(u, true);
        if (j && j.code === 0 && (j.result || j.data)) return (j.result || j.data);
      } catch (e) { }
    }
    return null;
  }

  async function resolveInfo() {
    const bvidFromUrl = getBvidFromUrl();
    const ep_id = getEpIdFromUrl();
    const season_id = getSeasonIdFromUrl();

    let type = (ep_id || season_id) ? 'bangumi' : 'video';
    let bvid = bvidFromUrl || '';
    let cid = '';
    let title = guessTitle();

    // 1) 先从 HTML 快速捞 cid/bvid（轻量）
    try {
      const html = document.documentElement?.innerHTML || '';
      const mcid = html.match(/"cid"\s*:\s*(\d{5,})/); // 放宽到 5 位
      if (mcid) cid = mcid[1];
      if (!bvid) {
        const mbv = html.match(/"bvid"\s*:\s*"(BV[0-9A-Za-z]+)"/);
        if (mbv) bvid = mbv[1];
      }
      // 有些页面 title 会带很多尾巴，轻度清理
      title = title.replace(/[-_ ]*(哔哩哔哩|bilibili).*$/i, '').trim() || title;
    } catch (e) { }

    // 2) 番剧：用 season 接口精确拿 cid/title（有时 bvid 不给也没关系）
    if (type === 'bangumi' && (!cid || !title)) {
      const season = await fetchSeasonByEpOrSs({ ep_id, season_id });
      if (season) {
        const eps = season.episodes || season.ep_list || [];
        const hit = ep_id ? (eps.find(x => Number(x.id) === ep_id || Number(x.ep_id) === ep_id) || eps[0]) : eps[0];
        if (hit) {
          if (!cid && hit.cid) cid = String(hit.cid);
          // 番剧标题更偏向“正片标题”
          const t = hit.long_title || hit.title || season.title;
          if (t) title = String(t).trim();
        } else if (season.title && !title) {
          title = String(season.title).trim();
        }
      }
    }

    // 3) 普通视频：用 view 接口拿 cid/title
    if (type === 'video' && bvid && !cid) {
      try {
        const j = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, true);
        if (j && j.code === 0 && j.data) {
          cid = String(j.data.cid || '');
          if (j.data.title) title = String(j.data.title).trim();
        }
      } catch (e) { }
    }

    return { type, bvid, cid, ep_id, season_id, title: title || 'bilibili' };
  }

  /********************
   * playurl：逐级 qn 探测最高可用 DASH
   ********************/
  // 常用能力位：DASH/HDR/4K/DV/8K/AV1 等合并，一般工具用 4048
  const FNVAL_MAX = 4048;

  async function requestPlayurl(info, qn) {
    const { type, bvid, cid, ep_id } = info;

    if (type === 'bangumi') {
      if (!ep_id || !cid) throw new Error('番剧页缺少 ep_id/cid（请刷新或先播放一下）');
      const url = `https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=${encodeURIComponent(ep_id)}&cid=${encodeURIComponent(cid)}&qn=${encodeURIComponent(qn)}&fnver=0&fnval=${FNVAL_MAX}&fourk=1`;
      return await fetchJson(url, true);
    } else {
      if (!bvid || !cid) throw new Error('缺少 bvid/cid（请刷新或先播放一下）');
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${encodeURIComponent(qn)}&fnver=0&fnval=${FNVAL_MAX}&fourk=1&platform=web`;
      return await fetchJson(url, true);
    }
  }

  function normalizePlayurlJson(j) {
    const data = j?.data || j?.result || null;
    const dash = data?.dash || null;
    const durl = data?.durl || null;
    const quality = data?.quality ?? data?.qn ?? null;
    const accept_quality = data?.accept_quality || [];
    const accept_description = data?.accept_description || [];
    return { dash, durl, quality, accept_quality, accept_description, raw: j };
  }

  function hasDashVA(dash) {
    return !!(dash && Array.isArray(dash.video) && dash.video.length && Array.isArray(dash.audio) && dash.audio.length);
  }

  /********************
   * 弹幕 / CC → ASS
   ********************/
  function danmakuXmlToAss(xmlText, meta) {
    const title = meta?.title || 'bilibili';
    const header =
`[Script Info]
Title: ${title}
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default, Arial, 42, &H00FFFFFF, &H000000FF, &H00111111, &H64000000, 0,0,0,0, 100,100,0,0, 1,2,0, 2, 20,20,20, 1
Style: Top, Arial, 42, &H00FFFFFF, &H000000FF, &H00111111, &H64000000, 0,0,0,0, 100,100,0,0, 1,2,0, 8, 20,20,20, 1
Style: Bottom, Arial, 42, &H00FFFFFF, &H000000FF, &H00111111, &H64000000, 0,0,0,0, 100,100,0,0, 1,2,0, 2, 20,20,20, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const ds = [];
    const re = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
    let m;
    while ((m = re.exec(xmlText))) {
      const p = m[1].split(',');
      const t = parseFloat(p[0]) || 0;
      const mode = parseInt(p[1], 10) || 1;
      const size = parseInt(p[2], 10) || 25;
      const color = parseInt(p[3], 10) || 16777215;
      const text = m[2].replace(/<\/?[^>]+>/g, '').replace(/\\N/g, ' ').trim();
      if (!text) continue;
      ds.push({ t, mode, size, color, text });
    }
    ds.sort((a, b) => a.t - b.t);

    function assTime(sec) {
      const h = Math.floor(sec / 3600);
      const mm = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const cs = Math.floor((s - Math.floor(s)) * 100);
      const ss = Math.floor(s);
      const pad = (n) => String(n).padStart(2, '0');
      return `${h}:${pad(mm)}:${pad(ss)}.${pad(cs)}`;
    }
    function bgrHex(dec) {
      const r = (dec >> 16) & 255;
      const g = (dec >> 8) & 255;
      const b = dec & 255;
      const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
      return `&H00${hex2(b)}${hex2(g)}${hex2(r)}`;
    }

    const W = 1920, H = 1080;
    const scrollDur = 7;
    const stillDur = 4;
    const lineH = 52;
    const maxLines = 18;
    const lanes = new Array(maxLines).fill(0);

    const pickLane = (start, dur) => {
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= start) { lanes[i] = start + dur; return i; }
      }
      let idx = 0;
      for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[idx]) idx = i;
      lanes[idx] = start + dur;
      return idx;
    };

    let body = '';
    for (const d of ds) {
      const start = d.t;
      const isTop = d.mode === 5;
      const isBottom = d.mode === 4;
      const isScroll = !isTop && !isBottom;

      const dur = isScroll ? scrollDur : stillDur;
      const end = start + dur;

      const st = assTime(start);
      const et = assTime(end);

      const safeText = String(d.text).replace(/[{}]/g, '').replace(/,/g, '，');
      const colorTag = `\\c${bgrHex(d.color)}`;
      const sizeTag = `\\fs${Math.max(22, Math.min(72, Math.round(d.size * 1.4)))}`;

      if (isTop) {
        const tag = `{${colorTag}${sizeTag}\\an8\\pos(${Math.floor(W / 2)},80)}`;
        body += `Dialogue: 0,${st},${et},Top,,0,0,0,,${tag}${safeText}\n`;
      } else if (isBottom) {
        const tag = `{${colorTag}${sizeTag}\\an2\\pos(${Math.floor(W / 2)},${H - 80})}`;
        body += `Dialogue: 0,${st},${et},Bottom,,0,0,0,,${tag}${safeText}\n`;
      } else {
        const lane = pickLane(start, dur);
        const y = 60 + (lane % maxLines) * lineH;
        const x1 = W + 40;
        const x2 = -40 - safeText.length * 20;
        const tag = `{${colorTag}${sizeTag}\\move(${x1},${y},${x2},${y})}`;
        body += `Dialogue: 0,${st},${et},Default,,0,0,0,,${tag}${safeText}\n`;
      }
    }

    return header + body;
  }

  async function fetchDanmakuXml(cid) {
    // 更稳的弹幕 XML（oid=cid）
    const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`;
    const r = await fetch(url, { credentials: 'include' });
    return await r.text();
  }

  async function fetchCCSubtitles(bvid, cid) {
    const url = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
    const j = await fetchJson(url, true);
    if (!j || j.code !== 0) throw new Error('字幕接口失败');
    return j.data?.subtitle?.subtitles || [];
  }

  async function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 600);
  }

  /********************
   * 前缀 / 命令生成（a-Shell / 快捷指令）
   ********************/
  function buildPrefix(info, chosen) {
    const base = `${info.type === 'bangumi' ? ('ep' + (info.ep_id || '')) : (info.bvid || 'bilibili')}_${info.title || 'bilibili'}`;
    const qTag = chosen?.label ? `_${chosen.label}` : '';
    return sanitizeFileName(base + qTag);
  }

  function shortenUrl(u) {
    if (!u) return '';
    u = String(u);
    if (u.length <= 140) return u;
    return u.slice(0, 90) + '…' + u.slice(-40);
  }

  function makeAShellCommand(prefix, vUrl, aUrl) {
    const ua = 'Mozilla/5.0';
    const ref = 'https://www.bilibili.com';
    const p = prefix;

    // ✅ 打包同名前缀：把 "$PREFIX"*.ass 全部一起 zip（弹幕/CC 都行）
    return `# ===== Bilibili iOS a-Shell 一键命令（可直接粘贴执行）=====
# 输出：
# - ${p}.mp4
# - ${p}.zip（包含 mp4 + 同名前缀的 .ass / .cc.ass 等）

set -e

PREFIX=${JSON.stringify(p)}
VURL=${JSON.stringify(vUrl)}
AURL=${JSON.stringify(aUrl)}
UA=${JSON.stringify(ua)}
REF=${JSON.stringify(ref)}

# 建议：a-Shell 的 Documents 目录（执行完可在 a-Shell 里分享/导出到“文件”）
cd "$HOME/Documents" 2>/dev/null || cd "$HOME"

echo "[1/4] Download video..."
curl -L --retry 3 --retry-delay 1 -A "$UA" -H "Referer: $REF" -o "$PREFIX.video.m4s" "$VURL"

echo "[2/4] Download audio..."
curl -L --retry 3 --retry-delay 1 -A "$UA" -H "Referer: $REF" -o "$PREFIX.audio.m4s" "$AURL"

echo "[3/4] Merge to MP4 (no re-encode)..."
ffmpeg -hide_banner -y -i "$PREFIX.video.m4s" -i "$PREFIX.audio.m4s" -c copy -movflags +faststart "$PREFIX.mp4"

echo "[4/4] Zip (mp4 + any ass with same prefix)..."
ASSFILES=$(ls "$PREFIX"*.ass 2>/dev/null || true)
if [ -n "$ASSFILES" ]; then
  zip -y -q "$PREFIX.zip" "$PREFIX.mp4" $ASSFILES && echo "OK: $PREFIX.zip"
else
  zip -y -q "$PREFIX.zip" "$PREFIX.mp4" && echo "OK: $PREFIX.zip (no ass)"
fi

echo "DONE: $PREFIX.mp4"
`;
  }

  /********************
   * UI
   ********************/
  const state = {
    info: null,
    parsed: null,
    chosen: null,   // {qn,label,width,height,fps,codecid,videoBw,audioBw,v,a}
    chosenQn: null, // 请求成功的 qn
  };

  function buildPanel() {
    const box = document.createElement('div');
    box.id = 'bili-ios-tool';
    box.style.cssText = `
      position: fixed; right: 14px; bottom: 140px;
      z-index: 999998; font-family: -apple-system, system-ui;
    `;

    const btn = document.createElement('button');
    btn.textContent = 'B站 iOS 工具';
    btn.style.cssText = `
      padding: 10px 12px; border-radius: 12px;
      border: none; background: rgba(0,0,0,.72);
      color: #fff; font-size: 14px;
      box-shadow: 0 6px 18px rgba(0,0,0,.25);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      display: none;
      width: min(92vw, 560px);
      background: rgba(20,20,20,.92);
      color: #fff; border-radius: 16px;
      padding: 12px; margin-top: 10px;
      box-shadow: 0 14px 38px rgba(0,0,0,.35);
    `;

    const row1 = document.createElement('div');
    row1.style.cssText = `display:flex; gap:10px;`;
    const bDan = document.createElement('button');
    bDan.textContent = '弹幕 → ASS';
    const bCC = document.createElement('button');
    bCC.textContent = 'CC → ASS';
    [bDan, bCC].forEach(b => {
      b.style.cssText = `
        flex:1; padding: 12px 10px;
        border-radius: 12px; border:none;
        background: #2b84ff; color:#fff;
        font-size: 15px; font-weight: 600;
      `;
    });
    row1.appendChild(bDan);
    row1.appendChild(bCC);

    const row2 = document.createElement('div');
    row2.style.cssText = `display:flex; gap:10px; margin-top: 10px;`;
    const bLinks = document.createElement('button');
    bLinks.textContent = '显示/复制 链接(最高画质)';
    bLinks.style.cssText = `
      flex:1; padding: 12px 10px;
      border-radius: 12px; border:none;
      background: #3a3a3a; color:#fff;
      font-size: 14px;
    `;
    row2.appendChild(bLinks);

    const row3 = document.createElement('div');
    row3.style.cssText = `display:flex; gap:10px; margin-top: 10px;`;
    const bAShell = document.createElement('button');
    bAShell.textContent = '生成 a-Shell 一键命令';
    const bShortcut = document.createElement('button');
    bShortcut.textContent = '生成 快捷指令文本';
    [bAShell, bShortcut].forEach(b => {
      b.style.cssText = `
        flex:1; padding: 12px 10px;
        border-radius: 12px; border:none;
        background: #4a4a4a; color:#fff;
        font-size: 14px;
      `;
    });
    row3.appendChild(bAShell);
    row3.appendChild(bShortcut);

    const row4 = document.createElement('div');
    row4.style.cssText = `margin-top:10px;`;
    const bAll = document.createElement('button');
    bAll.textContent = '复制当前全部信息';
    bAll.style.cssText = `
      width:100%; padding: 12px 10px;
      border-radius: 12px; border:none;
      background: #ff3b5c; color:#fff;
      font-size: 15px; font-weight: 700;
    `;
    row4.appendChild(bAll);

    const out = document.createElement('pre');
    out.style.cssText = `
      margin-top: 10px; padding: 10px 10px;
      background: rgba(0,0,0,.35);
      border-radius: 12px; max-height: 34vh;
      overflow: auto; white-space: pre-wrap;
      font-size: 12px; line-height: 1.35;
    `;

    panel.appendChild(row1);
    panel.appendChild(row2);
    panel.appendChild(row3);
    panel.appendChild(row4);
    panel.appendChild(out);

    btn.addEventListener('click', () => {
      panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
    });

    box.appendChild(btn);
    box.appendChild(panel);
    if (window.__MT_attach && window.__MT_attach('bili', box)) {
      // attached to master panel
    } else {
      document.body.appendChild(box);
    }

    return { out, bDan, bCC, bLinks, bAShell, bShortcut, bAll };
  }

  const ui = buildPanel();

  async function ensureInfo() {
    if (!state.info) state.info = await resolveInfo();
    return state.info;
  }

  function formatInfoText() {
    const info = state.info || {};
    const parsed = state.parsed || {};
    const ch = state.chosen || {};
    const dash = parsed.dash || {};
    const bestV = ch.v;
    const bestA = ch.a;

    const prefix = buildPrefix(info, ch);

    const lines = [];
    lines.push(`【B站 iOS 工具导出】`);
    lines.push(`type: ${info.type || 'unknown'}`);
    lines.push(`bvid: ${info.bvid || '未识别'}`);
    lines.push(`cid: ${info.cid || '未识别'}`);
    if (info.type === 'bangumi') lines.push(`ep_id: ${info.ep_id || '未识别'}`);
    lines.push(`title: ${info.title || ''}`);
    lines.push('');

    if (parsed.accept_quality?.length) {
      lines.push(`accept_quality: ${parsed.accept_quality.join(', ')}`);
      if (parsed.accept_description?.length) lines.push(`accept_desc: ${parsed.accept_description.join(' / ')}`);
    }

    if (ch.qn) {
      lines.push(`✅ chosen qn=${ch.qn} (${ch.label || ''})  ${ch.width || '?'}x${ch.height || '?'}  ${ch.fps || 0}fps  codecid=${ch.codecid ?? '?'}`);
      lines.push(`video bw=${ch.videoBw || 0}`);
      lines.push(`audio bw=${ch.audioBw || 0}`);
    }
    if (state.chosenQn != null) lines.push(`requested qn=${state.chosenQn}`);

    lines.push('');
    lines.push('[playurl]');
    lines.push(`- durl：${(parsed.durl && parsed.durl.length) ? parsed.durl.length + ' 条' : '无'}`);
    lines.push(`- dash video：${(dash.video && dash.video.length) ? dash.video.length + ' 条' : '无'}`);
    if (bestV) lines.push(`best dash.video: ${pickUrl(bestV)}`);
    lines.push(`- dash audio：${(dash.audio && dash.audio.length) ? dash.audio.length + ' 条' : '无'}`);
    if (bestA) lines.push(`best dash.audio: ${pickUrl(bestA)}`);

    lines.push('');
    lines.push(`prefix: ${prefix}`);
    lines.push('提示：durl=无 很正常（DASH 音视频分离）。要合并 mp4 用 a-Shell 的 ffmpeg。');

    return lines.join('\n');
  }

  function showLinksSummary() {
    const info = state.info || {};
    const ch = state.chosen || {};
    const bestV = ch.v;
    const bestA = ch.a;

    const prefix = buildPrefix(info, ch);
    const vUrl = pickUrl(bestV);
    const aUrl = pickUrl(bestA);

    ui.out.textContent =
`✅ 已抓到最高可用档位！
chosen qn=${ch.qn || '?'}  ${ch.width || '?'}x${ch.height || '?'}  ${ch.fps || 0}fps  (${ch.label || ''})
video bw=${ch.videoBw || 0}
audio bw=${ch.audioBw || 0}
prefix: ${prefix}

[best urls]
video: ${shortenUrl(vUrl)}
audio: ${shortenUrl(aUrl)}

接下来：
1) 先点“弹幕→ASS”（生成 ${prefix}.ass）
2) 点“生成 a-Shell 一键命令”复制命令
3) 去 a-Shell 粘贴执行（输出 ${prefix}.mp4 + ${prefix}.zip）

说明：想要 8K/HDR/杜比视界，资源必须支持且通常需要登录/VIP；脚本会自动回落到你当前可用的最高档位。`;
  }

  async function ensureBestPlayurl() {
    const info = await ensureInfo();

    const failed = [];
    for (const qn of QN_TRY_LIST) {
      try {
        const j = await requestPlayurl(info, qn);
        if (j?.code && j.code !== 0) {
          failed.push(`qn=${qn} code=${j.code} msg=${j.message || j.msg || 'unknown'}`);
          continue;
        }
        const n = normalizePlayurlJson(j);
        if (!hasDashVA(n.dash)) {
          failed.push(`qn=${qn} ok但无dash(可能无权限/返回不完整)`);
          continue;
        }

        // 成功：第一个成功就是最高可用
        state.parsed = n;
        state.chosenQn = qn;

        const dash = n.dash;
        const bestV = pickBestBy(dash.video, scoreDashVideo);
        const bestA = pickBestBy(dash.audio, scoreDashAudio);

        if (!bestV || !bestA) {
          failed.push(`qn=${qn} dash不完整(bestV/bestA为空)`);
          continue;
        }

        const qnChosen = Number(bestV.id) || qn || n.quality || null;

        state.chosen = {
          qn: qnChosen,
          label: chosenLabelFromQn(qnChosen),
          width: bestV.width || null,
          height: bestV.height || null,
          fps: parseFrameRate(bestV.frame_rate || bestV.framerate),
          codecid: bestV.codecid ?? null,
          videoBw: getBw(bestV),
          audioBw: getBw(bestA),
          v: bestV,
          a: bestA,
        };

        return true;
      } catch (e) {
        failed.push(`qn=${qn} exception=${e?.message || e}`);
      }
    }

    ui.out.textContent =
`❌ 没找到可用的 DASH（逐级 qn 都失败）
可能原因：
- 未登录（常见 -101）
- 清晰度需要大会员/地区限制（常见 -10403）
- 风控/拦截（-412/-403）
- 或该视频本身不提供更高档位

失败记录：
- ${failed.join('\n- ')}

建议：
1) 先登录 B站账号
2) 回到页面先点播放一下（或切换一次清晰度）
3) 再点一次“显示/复制 链接(最高画质)”`;
    state.parsed = null;
    state.chosen = null;
    state.chosenQn = null;
    return false;
  }

  /********************
   * 按钮绑定
   ********************/
  ui.bLinks.addEventListener('click', async () => {
    ui.out.textContent = `⏳ 逐级尝试最高画质中…\nqn=${QN_TRY_LIST.join(' → ')}`;
    const ok = await ensureBestPlayurl();
    if (!ok) return;

    showLinksSummary();

    // 默认复制“全部信息”
    const txt = formatInfoText();
    await copyText(txt);
    toast('已复制：当前全部信息');
  });

  ui.bAll.addEventListener('click', async () => {
    const txt = formatInfoText();
    await copyText(txt);
    toast('已复制：当前全部信息');
  });

  ui.bDan.addEventListener('click', async () => {
    try {
      const info = await ensureInfo();
      if (!info.cid) throw new Error('未识别 cid（请先点播放/刷新）');

      ui.out.textContent = '⏳ 获取弹幕 XML 中...';
      const xml = await fetchDanmakuXml(info.cid);
      const ass = danmakuXmlToAss(xml, { title: info.title });

      const prefix = buildPrefix(info, state.chosen || null);
      const fn = `${prefix}.ass`;
      await downloadTextFile(fn, ass);

      ui.out.textContent =
`✅ 已导出弹幕 ASS：${fn}

提示：
- iOS 可在下载完成后用 Safari “分享 → 存储到文件”
- 或者留在下载目录，后续 a-Shell 命令会把同名前缀 *.ass 一起打包进 zip`;
      toast('弹幕ASS已导出');
    } catch (e) {
      ui.out.textContent = `❌ 弹幕→ASS 失败：${e?.message || e}`;
    }
  });

  ui.bCC.addEventListener('click', async () => {
    try {
      const info = await ensureInfo();
      if (!info.bvid || !info.cid) throw new Error('未识别 bvid/cid（番剧页一般没有bvid，建议用弹幕ASS或先点“显示/复制链接”）');

      ui.out.textContent = '⏳ 获取 CC 字幕列表中...';
      const subs = await fetchCCSubtitles(info.bvid, info.cid);
      if (!subs.length) throw new Error('该视频没有 CC 字幕');

      const s0 = subs[0];
      const subUrl = s0.subtitle_url;
      if (!subUrl) throw new Error('subtitle_url 为空');

      ui.out.textContent = `✅ 找到字幕：${s0.lan_doc || s0.lan}\n⏳ 下载字幕 JSON 中...`;
      const r = await fetch(subUrl, { credentials: 'include' });
      const j = await r.json();

      function assTime(sec) {
        const h = Math.floor(sec / 3600);
        const mm = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const cs = Math.floor((s - Math.floor(s)) * 100);
        const ss = Math.floor(s);
        const pad = (n) => String(n).padStart(2, '0');
        return `${h}:${pad(mm)}:${pad(ss)}.${pad(cs)}`;
      }

      const lines = [];
      lines.push(`[Script Info]
Title: ${info.title}
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default, Arial, 54, &H00FFFFFF, &H000000FF, &H00111111, &H64000000, 0,0,0,0, 100,100,0,0, 1,2,0, 2, 40,40,40, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`);

      for (const it of (j.body || [])) {
        const from = Number(it.from || 0);
        const to = Number(it.to || (from + 2));
        if (!isFinite(from) || !isFinite(to) || to <= from) continue;
        const txt = String(it.content || '').replace(/\r?\n/g, ' ').replace(/[{}]/g, '').replace(/,/g, '，');
        lines.push(`Dialogue: 0,${assTime(from)},${assTime(to)},Default,,0,0,0,,{\\an2\\pos(960,1000)}${txt}`);
      }

      const ass = lines.join('\n');
      const prefix = buildPrefix(info, state.chosen || null);
      const lang = (s0.lan_doc || s0.lan || 'cc').replace(/[^\w-]+/g, '_');
      const fn = `${prefix}.${lang}.ass`;
      await downloadTextFile(fn, ass);

      ui.out.textContent =
`✅ 已导出 CC→ASS：${fn}

提示：
- a-Shell 的 zip 会把同名前缀 ${prefix}*.ass 都一起打包`;
      toast('CC ASS已导出');
    } catch (e) {
      ui.out.textContent =
`❌ CC→ASS 失败：${e?.message || e}

说明：
- 番剧/部分源 CC 字幕接口可能不同
- 普通投稿视频一般可用
- 需要的话我可以再给你加“番剧字幕接口”分支`;
    }
  });

  ui.bAShell.addEventListener('click', async () => {
    const ok = state.chosen ? true : await ensureBestPlayurl();
    if (!ok) return;

    const info = state.info;
    const ch = state.chosen || {};
    const vUrl = pickUrl(ch.v);
    const aUrl = pickUrl(ch.a);

    if (!vUrl || !aUrl) {
      ui.out.textContent = '❌ 没有可用的 dash.video / dash.audio 链接（可能是权限/地区/风控）。';
      return;
    }

    const prefix = buildPrefix(info, ch);
    const cmd = makeAShellCommand(prefix, vUrl, aUrl);
    await copyText(cmd);

    ui.out.textContent =
`✅ 已复制 a-Shell 一键命令（可直接粘贴执行）

输出前缀：${prefix}
chosen qn=${ch.qn || '?'} (${ch.label || ''})
video bw=${ch.videoBw || 0}
audio bw=${ch.audioBw || 0}

video: ${shortenUrl(vUrl)}
audio: ${shortenUrl(aUrl)}

提示：
- a-Shell 执行完后，在 a-Shell 里“分享/导出”保存到“文件”
- zip 会自动把同名前缀 ${prefix}*.ass 一起打包`;
    toast('已复制：a-Shell 命令');
  });

  ui.bShortcut.addEventListener('click', async () => {
    const ok = state.chosen ? true : await ensureBestPlayurl();
    if (!ok) return;

    const info = state.info;
    const ch = state.chosen || {};
    const vUrl = pickUrl(ch.v);
    const aUrl = pickUrl(ch.a);

    if (!vUrl || !aUrl) {
      ui.out.textContent = '❌ 没有可用的 dash.video / dash.audio 链接（可能是权限/地区/风控）。';
      return;
    }

    const prefix = buildPrefix(info, ch);
    const txt = makeAShellCommand(prefix, vUrl, aUrl);
    await copyText(txt);

    ui.out.textContent =
`✅ 已复制“快捷指令用文本”（就是可执行的 a-Shell 命令脚本）

你这样用（两种都行）：
A) 手动：打开 a-Shell → 粘贴 → 回车
B) 快捷指令：新建快捷指令 → 添加动作：a-Shell → Execute Command → 把剪贴板内容粘进去 → 运行

输出：
- ${prefix}.mp4
- ${prefix}.zip（含 mp4 + ${prefix}*.ass）

chosen qn=${ch.qn || '?'} (${ch.label || ''})
video bw=${ch.videoBw || 0}
audio bw=${ch.audioBw || 0}
`;
    toast('已复制：快捷指令文本');
  });

  // 初始提示
  (async () => {
    await sleep(600);
    const info = await ensureInfo().catch(() => null);
    const where = info ? `type=${info.type}  bvid=${info.bvid || '-'}  cid=${info.cid || '-'}${info.type === 'bangumi' ? ('  ep_id=' + (info.ep_id || '-')) : ''}` : '';
    ui.out.textContent =
`提示（iOS）：
1) 在该页点“显示/复制 链接(最高画质)”——脚本会逐级尝试 qn=${QN_TRY_LIST.join('→')}，找到最高可用档位
2) 点“弹幕→ASS”（导出 ${info ? buildPrefix(info, null) : '前缀'}.ass）
3) 点“生成 a-Shell 一键命令”去 a-Shell 执行，得到 .mp4 + .zip（zip会打包同名前缀*.ass）

${where}

说明：
- 8K/HDR/杜比/高帧率通常需要登录/VIP/资源支持
- durl=无 很正常（DASH 音视频分离）
`;
  })();

})();