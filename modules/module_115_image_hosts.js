// ==UserScript==
// @name         图床终极合并版（单面板｜t66y全下 + tu.ymawv抓取轮播 + 通用直链）
// @namespace    https://tampermonkey.net/
// @version      4.3.0
// @description  单面板整合：t66y全下（含base64兜底）+ sehuatang/dmn12 网络拦截抓 tu.ymawv 真图并轮播 + 通用图片直链；tu.ymawv：按域名分组 + 疑似验证链接前缀标注（前缀可面板设置并记住），并保留“复制纯URL”
// @match        *://*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /********************************************************************
   * Host 判断
   ********************************************************************/
  const host = location.hostname.toLowerCase();
  const isT66Y = host === 't66y.com' || host.endsWith('.t66y.com');
  const isSehuatang = host === 'sehuatang.net' || host.endsWith('.sehuatang.net');
  const isDMN12 = host === 'dmn12.vip' || host.endsWith('.dmn12.vip');
  const needNetHook = (isSehuatang || isDMN12);

  /********************************************************************
   * 通用工具
   ********************************************************************/
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const absUrl = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };

  function uniq(arr) {
    const s = new Set();
    const out = [];
    for (const x of arr) {
      const k = (x || '').trim();
      if (!k) continue;
      if (!s.has(k)) { s.add(k); out.push(k); }
    }
    return out;
  }

  function sanitizeFilename(s) {
    return (s || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'untitled';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad3(n) { return String(n).padStart(3, '0'); }

  function isLikelyHumanVerifyUrl(u) {
    const s = (u || '').toLowerCase();
    if (/(captcha|recaptcha|hcaptcha|turnstile|cf-challenge|cloudflare|challenge|verify|verification|human|bot|robot|slider|geetest|sec-check|anti-bot)/i.test(s)) return true;
    if (/(\/cdn-cgi\/|__cf_chl|cf_clearance|captcha_id|verifytoken|challenge_id)/i.test(s)) return true;
    return false;
  }

  function nowTimeStr() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${hh}:${mm}:${ss}`;
  }

  function safeGetLS(key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function safeSetLS(key, val) {
    try { localStorage.setItem(key, val); } catch {}
  }

  /********************************************************************
   * 全局状态（单面板共用）
   ********************************************************************/
  const ST = {
    tab: 'univ',           // univ | t66y | ymawv
    subMode: 'urls',       // urls | shortcuts | aria2 | idm | idm2（仅通用 tab）
    useComputedBG: false,  // 通用：是否启用计算样式抓背景图
    onlyOP: true,          // t66y：只抓楼主
    univUrls: [],
    t66yLinks: [],
    ymawvSet: new Set(),

    // tu.ymawv 开关（默认全开）
    yGroupByHost: true,
    yMarkVerify: true,

    // ✅ A 方案：可自定义前缀 + 记忆
    yVerifyPrefix: safeGetLS('__onepanel_verify_prefix__', '【需验证码】 '),

    log: [],
  };

  function logLine(s) {
    ST.log.push(`[${nowTimeStr()}] ${s}`);
    if (ST.log.length > 300) ST.log = ST.log.slice(-300);
    renderPanel();
  }

  /********************************************************************
   * Part A：通用网页图片直链工具（a[href]原图优先 + 背景图可选）
   ********************************************************************/
  const MIN_IMG_W = 120;
  const MIN_IMG_H = 120;
  const BG_MIN_AREA = 120 * 120;

  function normalizeUrl(u) {
    if (!u) return '';
    return String(u).trim().replace(/&amp;/g, '&');
  }
  function isBad(u) {
    return /adblo_ck|a\.d\/|blank|loading|spacer|pixel|avatar|icon|logo|sprite|data:image/i.test(u);
  }
  function pickMainContainer() {
    return (
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('#content') ||
      document.querySelector('.content') ||
      document.querySelector('.post-content') ||
      document.querySelector('.entry-content') ||
      document.querySelector('.article-content') ||
      document.querySelector('.markdown-body') ||
      document.body
    );
  }
  function pickFromSrcset(srcset) {
    if (!srcset) return '';
    const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    return parts[parts.length - 1].split(' ')[0];
  }
  function isProbablyNonImagePage(u) {
    return /\.(html?|php|aspx?|jsp)(\?|#|$)/i.test(u || '');
  }
  function pickAnchorHrefAsOriginal(img) {
    const a = img.closest('a[href]');
    if (!a) return '';
    let href = normalizeUrl(a.getAttribute('href'));
    if (!href) return '';
    href = absUrl(href);
    if (!/^https?:\/\//i.test(href)) return '';
    if (isProbablyNonImagePage(href)) return '';
    if (isBad(href)) return '';
    return href;
  }
  function extractBgUrlsFromCss(bg) {
    if (!bg || bg === 'none') return [];
    const out = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/ig;
    let m;
    while ((m = re.exec(bg))) {
      const u = normalizeUrl(m[2]);
      if (u) out.push(u);
    }
    return out;
  }
  function looksLikeImageUrlLoose(u) {
    if (!u) return false;
    if (/^data:image/i.test(u)) return false;
    return /^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u);
  }

  function collectBackgroundImageUrls(root, opts = {}) {
    const {
      inlineOnly = true,
      useComputed = false,
      minArea = BG_MIN_AREA,
    } = opts;

    const urls = [];
    const seen = new Set();

    const els = root.querySelectorAll('*');
    els.forEach(el => {
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.width * rect.height < minArea) return;

      let bg = '';

      if (inlineOnly) {
        const s = el.getAttribute('style') || '';
        if (/background-image\s*:/.test(s) || /background\s*:/.test(s)) {
          bg = el.style.backgroundImage || el.style.background || '';
        }
      } else {
        bg = el.style.backgroundImage || el.style.background || '';
      }

      if (!bg && useComputed) {
        try { bg = getComputedStyle(el).backgroundImage; } catch (e) {}
      }

      const candidates = extractBgUrlsFromCss(bg);
      candidates.forEach(u0 => {
        if (!looksLikeImageUrlLoose(u0)) return;
        let u = absUrl(u0);
        if (!/^https?:\/\//i.test(u)) return;
        if (isBad(u)) return;
        if (!seen.has(u)) {
          seen.add(u);
          urls.push(u);
        }
      });
    });

    return urls;
  }

  function collectImageUrls() {
    const box = pickMainContainer();
    const urls = [];
    const seen = new Set();

    box.querySelectorAll('img').forEach(img => {
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if ((nw && nw < MIN_IMG_W) || (nh && nh < MIN_IMG_H)) return;

      let u = pickAnchorHrefAsOriginal(img);

      if (!u) {
        u =
          img.getAttribute('data-original') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-lazy') ||
          img.getAttribute('data-url') ||
          img.getAttribute('ess-data') ||
          img.getAttribute('src') ||
          pickFromSrcset(img.getAttribute('srcset'));
      }

      u = normalizeUrl(u);
      if (!u) return;
      if (isBad(u)) return;

      u = absUrl(u);
      if (!/^https?:\/\//i.test(u)) return;
      if (isProbablyNonImagePage(u)) return;

      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    });

    const bgUrls = collectBackgroundImageUrls(box, {
      inlineOnly: true,
      useComputed: ST.useComputedBG,
      minArea: BG_MIN_AREA
    });

    bgUrls.forEach(u => {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    });

    return urls;
  }

  function getExtFromUrl(u) {
    try {
      const p = new URL(u).pathname;
      const m = p.match(/\.([a-zA-Z0-9]{2,5})$/);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    return 'jpg';
  }

  function makeAria2Input(urls) {
    const ref = location.href;
    const lines = [];
    urls.forEach((u, i) => {
      const ext = getExtFromUrl(u);
      const name = `${pad2(i + 1)}.${ext}`;
      lines.push(u);
      lines.push(`  referer=${ref}`);
      lines.push(`  out=${name}`);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function makeIDMListWithNames(urls) {
    return urls.map((u, i) => {
      const ext = getExtFromUrl(u);
      const name = `${pad2(i + 1)}.${ext}`;
      return `${u}\t${name}`;
    }).join('\n');
  }

  /********************************************************************
   * Part B：t66y 23img/66img 全部下载（含 base64 兜底）
   ********************************************************************/
  const FILENAME_RULE = `t66y_{tid}_{title}_{idx}_{key}.{ext}`;
  const CONCURRENCY = 1;
  const DOWNLOAD_INTERVAL_MS = 2800;
  const AFTER_BLOB_CLICK_MS = 1200;

  const ALLOW_HOST_RE = /(^|\.)((23img\.com)|(66img\.(com|cc)))$/i;
  function getTid() {
    try {
      const u = new URL(location.href);
      const tid = u.searchParams.get('tid') || u.searchParams.get('threadid') || '';
      if (tid) return tid;
      const m = location.href.match(/tid=(\d+)/i);
      return m ? m[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
  function getTitle() {
    const t1 = $('h1')?.textContent;
    const t2 = $('title')?.textContent;
    return sanitizeFilename(t1 || t2 || 't66y');
  }
  function detectEasyImage(url) {
    try {
      const u = new URL(url);
      if (!ALLOW_HOST_RE.test(u.hostname)) return false;
      const looksLikeEasyPath = /\/(i|img)\/\d{4}\/\d{2}\/\d{2}\//i.test(u.pathname);
      if (!looksLikeEasyPath) return false;
      return true;
    } catch {
      return false;
    }
  }
  function getKey(url) {
    try {
      const u = new URL(url);
      const base = (u.pathname.split('/').pop() || '').split('?')[0];
      const key = base.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
      return sanitizeFilename(key || 'img');
    } catch {
      return 'img';
    }
  }
  function extFromContentType(ct) {
    const c = (ct || '').toLowerCase();
    if (c.includes('png')) return 'png';
    if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
    if (c.includes('webp')) return 'webp';
    if (c.includes('gif')) return 'gif';
    return 'bin';
  }
  function buildFilename({ idx, key, ext }) {
    return FILENAME_RULE
      .replaceAll('{site}', 't66y')
      .replaceAll('{tid}', sanitizeFilename(getTid()))
      .replaceAll('{title}', getTitle())
      .replaceAll('{idx}', pad3(idx))
      .replaceAll('{key}', key)
      .replaceAll('{ext}', ext);
  }
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }
  function gmGet(url, responseType = 'arraybuffer') {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        onload: (r) => {
          const headers = r.responseHeaders || '';
          const getH = (name) => {
            const m = headers.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'));
            return m ? m[1].trim() : '';
          };
          resolve({
            status: r.status,
            contentType: getH('content-type') || '',
            finalUrl: r.finalUrl || '',
            data: r.response,
            text: r.responseText || ''
          });
        },
        onerror: () => resolve({ status: 0, contentType: '', finalUrl: '', data: null, text: '' }),
      });
    });
  }

  const DATA_RE = /data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)/ig;
  function findDataImages(text) {
    const hits = [];
    let m;
    while ((m = DATA_RE.exec(text || ''))) {
      const ext = (m[1].toLowerCase() === 'jpeg') ? 'jpg' : m[1].toLowerCase();
      hits.push({ mime: `image/${m[1].toLowerCase().replace('jpg', 'jpeg')}`, ext, b64: m[2] });
    }
    const seen = new Set();
    return hits.filter(h => {
      const k = h.b64.slice(0, 80);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function decodeBase64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function extractT66YLinks(onlyOp = true) {
    let scopeRoots = [document.body];

    if (onlyOp) {
      const blocks = $$('.tr3, .t, .tr1, .tr2, .tr5, .read_tpc, .tpc_content').slice(0, 12);
      let best = null, bestScore = -1;
      for (const b of blocks) {
        const score = b.querySelectorAll('a[href], img, br').length;
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best) scopeRoots = [best];
    }

    const links = [];
    for (const root of scopeRoots) {
      $$('a[href]', root).forEach(a => {
        const u = absUrl(a.getAttribute('href'));
        if (detectEasyImage(u)) links.push(u);
      });
      $$('img[src]', root).forEach(img => {
        const u = absUrl(img.getAttribute('src') || '');
        if (detectEasyImage(u)) links.push(u);
      });
      const text = root.innerText || '';
      const re = /https?:\/\/[^\s"'<>]+/ig;
      let m;
      while ((m = re.exec(text))) {
        const u = m[0];
        if (detectEasyImage(u)) links.push(u);
      }
    }
    return uniq(links);
  }

  async function fetchAndDownloadOne(url, idx) {
    const key = getKey(url);
    const r = await gmGet(url, 'arraybuffer');
    const ct = (r.contentType || '').toLowerCase();

    if (ct.startsWith('image/')) {
      const ext = extFromContentType(ct);
      const filename = buildFilename({ idx, key, ext });
      const blob = new Blob([r.data], { type: r.contentType || 'application/octet-stream' });
      downloadBlob(blob, filename);
      logLine(`✅ t66y #${idx} image/* -> ${filename}`);
      await sleep(AFTER_BLOB_CLICK_MS);
      return;
    }

    let html = '';
    try {
      html = new TextDecoder('utf-8').decode(new Uint8Array(r.data || new ArrayBuffer(0)));
    } catch {
      const rt = await gmGet(url, 'text');
      html = rt.text || '';
    }

    const hits = findDataImages(html);
    if (!hits.length) {
      logLine(`❌ t66y #${idx} 返回 ${r.contentType || 'unknown'} 且无 base64（可能跳验证/动态渲染）`);
      logLine(`   URL: ${url}`);
      return;
    }

    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const filename = buildFilename({
        idx,
        key: `${key}${hits.length > 1 ? `_p${i + 1}` : ''}`,
        ext: h.ext
      });
      const blob = decodeBase64ToBlob(h.b64, h.mime);
      downloadBlob(blob, filename);
      logLine(`✅ t66y #${idx}${hits.length > 1 ? '-' + (i + 1) : ''} base64 -> ${filename}`);
      await sleep(AFTER_BLOB_CLICK_MS);
      await sleep(DOWNLOAD_INTERVAL_MS);
    }
  }

  async function runT66YQueue(urls) {
    logLine(`🚀 t66y 开始下载：${urls.length} 条（并发=${CONCURRENCY}，间隔=${DOWNLOAD_INTERVAL_MS}ms）`);
    for (let i = 0; i < urls.length; i++) {
      const idx = i + 1;
      logLine(`⬇️ t66y [${idx}/${urls.length}] ${urls[i]}`);
      try { await fetchAndDownloadOne(urls[i], idx); }
      catch (e) { logLine(`❌ t66y #${idx} 异常：${String(e)}`); }
      await sleep(DOWNLOAD_INTERVAL_MS);
    }
    logLine(`🎉 t66y 完成：${urls.length} 条`);
  }

  /********************************************************************
   * Part C：tu.ymawv 抓取 + 单标签轮播（网络拦截 + DOM 扫描）
   ********************************************************************/
  const YMAWV_IMG_RE = /https?:\/\/tu\.ymawv\.la\/tupian\/forum\/\d{6}\/\d{2}\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?/ig;
  const EASY_HOST_RE = /(^|\.)((23img\.com)|(66img\.(com|cc)))$/i;
  const EASY_PATH_RE = /\/(i|img)\/\d{4}\/\d{2}\/\d{2}\//i;

  function addYmawvHits(textOrUrl) {
    if (!textOrUrl) return;
    const txt = String(textOrUrl);

    let m;
    while ((m = YMAWV_IMG_RE.exec(txt))) ST.ymawvSet.add(m[0]);

    // 顺便抓 23img/66img（同一面板下更方便）
    const reAny = /https?:\/\/[^\s"'<>]+/ig;
    let n;
    while ((n = reAny.exec(txt))) {
      const u = n[0];
      try {
        const U = new URL(u);
        if (EASY_HOST_RE.test(U.hostname) && EASY_PATH_RE.test(U.pathname)) ST.ymawvSet.add(u);
      } catch {}
    }

    renderPanel();
  }

  async function openCarouselOneTab(urls, intervalMs = 2200) {
    if (!urls.length) return;
    const w = window.open(urls[0], '_blank');
    if (!w) { logLine('❌ 轮播被拦截：Safari 网站设置里允许弹窗'); return; }
    logLine(`🧷 已打开第1条，将轮播 ${urls.length} 条（${intervalMs}ms）`);
    for (let i = 1; i < urls.length; i++) {
      await sleep(intervalMs);
      try { w.location.href = urls[i]; logLine(`➡️ 轮播 ${i + 1}/${urls.length}`); }
      catch (e) { logLine(`❌ 轮播切换失败：${String(e)}`); break; }
    }
    logLine('✅ 轮播结束');
  }

  function injectNetHook() {
    if (!needNetHook) return;
    const code = `
      (function(){
        try{
          if (window.__YMAWV_NET_HOOKED__) return;
          window.__YMAWV_NET_HOOKED__ = 1;
        }catch(e){}

        const RE = ${YMAWV_IMG_RE.toString()};

        function emit(txt){
          try{
            const s = String(txt).slice(0, 2000000);
            window.postMessage({__ONEPANEL_YHIT__: 1, txt: s}, '*');
          }catch(e){}
        }

        const _fetch = window.fetch;
        if (_fetch) {
          window.fetch = function(){
            return _fetch.apply(this, arguments).then(async (res)=>{
              try{
                emit(res.url || '');
                const ct = (res.headers && res.headers.get('content-type')) || '';
                if (ct.includes('text') || ct.includes('json') || ct.includes('html') || ct === '') {
                  const clone = res.clone();
                  const txt = await clone.text();
                  if (RE.test(txt)) emit(txt);
                }
              }catch(e){}
              return res;
            });
          }
        }

        const X = window.XMLHttpRequest;
        if (X) {
          const open = X.prototype.open;
          const send = X.prototype.send;
          X.prototype.open = function(m,u){ this.__u = u; return open.apply(this, arguments); }
          X.prototype.send = function(){
            this.addEventListener('load', function(){
              try{
                emit(this.responseURL || this.__u || '');
                const rt = this.responseType;
                if (!rt || rt === 'text' || rt === 'json' || rt === 'document') {
                  const txt = this.responseText;
                  if (txt && RE.test(txt)) emit(txt);
                }
              }catch(e){}
            });
            return send.apply(this, arguments);
          }
        }

        try{ emit(document.documentElement.outerHTML); }catch(e){}
      })();
    `;
    const s = document.createElement('script');
    s.textContent = code;
    document.documentElement.appendChild(s);
    s.remove();
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__ONEPANEL_YHIT__ && typeof d.txt === 'string') addYmawvHits(d.txt);
  });

  /********************************************************************
   * tu.ymawv：分组 + 标注（格式化输出）
   ********************************************************************/
  function hostOfUrl(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch { return 'unknown'; }
  }

  function groupByHost(urls) {
    const mp = new Map();
    for (const u of urls) {
      const h = hostOfUrl(u);
      if (!mp.has(h)) mp.set(h, []);
      mp.get(h).push(u);
    }
    return mp;
  }

  function hostSortKey(h) {
    const priority = {
      'tu.ymawv.la': 1,
      '23img.com': 2,
      '66img.com': 3,
      '66img.cc': 4
    };
    return `${String(priority[h] || 99).padStart(2,'0')}_${h}`;
  }

  function formatYmawvOutput(urls, { group, markVerify }) {
    const arr = [...urls];
    arr.sort((a, b) => {
      const ha = hostSortKey(hostOfUrl(a));
      const hb = hostSortKey(hostOfUrl(b));
      if (ha !== hb) return ha < hb ? -1 : 1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });

    // ✅ 关键：使用可配置前缀
    const prefix = (u) => (markVerify && isLikelyHumanVerifyUrl(u)) ? (ST.yVerifyPrefix || '') : '';

    if (!group) {
      return arr.map(u => prefix(u) + u).join('\n');
    }

    const mp = groupByHost(arr);
    const hosts = [...mp.keys()].sort((a,b)=>hostSortKey(a)<hostSortKey(b)?-1:1);

    const lines = [];
    for (const h of hosts) {
      const list = mp.get(h) || [];
      lines.push(`# ${h} (${list.length})`);
      for (const u of list) lines.push(prefix(u) + u);
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  /********************************************************************
   * 单面板 UI
   ********************************************************************/
  GM_addStyle(`
#onePanelBtn{
  position:fixed;right:16px;bottom:80px;z-index:999999;
  background:#ff5a5f;color:#fff;padding:10px 14px;border-radius:10px;
  font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);
  user-select:none;
}
#onePanel{
  position:fixed;left:5%;top:8%;width:90%;max-height:84%;
  background:#111;color:#eee;z-index:1000000;border-radius:12px;
  display:none;overflow:hidden;border:1px solid rgba(255,255,255,.08);
  box-shadow:0 12px 34px rgba(0,0,0,.35);
}
#onePanel header{
  padding:10px 12px;background:#1f1f1f;display:flex;align-items:center;
  justify-content:space-between;gap:10px;
}
#onePanel header .title{
  font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:70%;
}
#onePanel header .actions button{
  margin-left:6px;padding:6px 10px;border-radius:8px;border:none;
  cursor:pointer;background:#333;color:#eee;
}
#onePanel .tabs{
  display:flex;gap:6px;padding:8px 10px;background:#151515;
  border-bottom:1px solid rgba(255,255,255,.06);overflow-x:auto;
  -webkit-overflow-scrolling:touch;
}
#onePanel .tab{
  padding:6px 10px;border-radius:999px;background:#2a2a2a;color:#ddd;
  font-size:12px;cursor:pointer;user-select:none;white-space:nowrap;
}
#onePanel .tab.active{background:#ff5a5f;color:#fff;}

#onePanel .subtabs{
  display:flex;gap:6px;padding:8px 10px;background:#101010;
  border-bottom:1px solid rgba(255,255,255,.06);overflow-x:auto;
  -webkit-overflow-scrolling:touch;
}
#onePanel .subtab{
  padding:6px 10px;border-radius:999px;background:#242424;color:#ddd;
  font-size:12px;cursor:pointer;user-select:none;white-space:nowrap;
}
#onePanel .subtab.active{background:#ff5a5f;color:#fff;}

#onePanel .tools{
  padding:8px 10px;background:#0f0f0f;display:flex;gap:8px;flex-wrap:wrap;
  border-bottom:1px solid rgba(255,255,255,.06);
}
#onePanel .tools button, #onePanel .tools label{
  border:1px solid rgba(255,255,255,.12); background:#1d1d1d; color:#eee;
  border-radius:10px; padding:7px 10px; font-size:12px; cursor:pointer;
}
#onePanel .tools label{display:inline-flex; align-items:center; gap:6px}
#onePanel .tools button.primary{background:#ff5a5f;border-color:#ff5a5f;color:#fff}
#onePanel .tools button.secondary{background:#333;border-color:#333;color:#eee}

#onePanel, #onePanel *{
  -webkit-user-select:text !important; user-select:text !important;
}
#oneTA{
  width:100%;height:44vh;background:#000;color:#0f0;border:none;
  padding:10px;font-size:12px;line-height:1.35;resize:none;outline:none;
  box-sizing:border-box;-webkit-user-select:text !important;
  user-select:text !important;-webkit-touch-callout:default !important;
  caret-color:#0f0;
}
#onePanel footer{
  padding:10px;background:#1f1f1f;display:flex;gap:8px;
  align-items:center;justify-content:space-between;flex-wrap:wrap;
}
#onePanel footer .meta{
  font-size:12px;color:#bbb;flex:1 1 100%;
}
#onePanel footer .btns{
  display:flex;gap:6px;flex-wrap:wrap;width:100%;
  justify-content:flex-end;
}
#onePanel footer button{
  padding:8px 10px;border-radius:10px;border:none;cursor:pointer;
  background:#ff5a5f;color:#fff;font-size:13px;
}
#onePanel footer button.secondary{
  background:#333 !important;color:#eee !important;
}
#oneLog{
  max-height:16vh; overflow:auto; white-space:pre-wrap;
  border-top:1px dashed rgba(255,255,255,.15);
  padding:10px; background:#0b0b0b; color:#ddd;
  font-size:12px; line-height:1.35;
}
  `);

  function getCurrentOutputText() {
    if (ST.tab === 'univ') {
      const urls = ST.univUrls;
      if (!urls.length) {
        return [
          '未找到图片。',
          '',
          '提示：',
          '1) 页面里需要有 <img> 或 background-image:url(...)。',
          '2) 有些站点图片用 canvas/视频帧/加密接口渲染，本脚本抓不到。',
          '3) 先滚动让懒加载图片加载后再点“刷新”。',
          '4) 背景图如果是 CSS 文件里定义的，点“BG:计算样式”（更慢）。',
          '5) 跳转/防盗链图：优先用 aria2 模式（自动加 referer）。'
        ].join('\n');
      }
      if (ST.subMode === 'urls') return urls.join('\n');
      if (ST.subMode === 'shortcuts') return urls.join('\n');
      if (ST.subMode === 'aria2') return makeAria2Input(urls);
      if (ST.subMode === 'idm') return urls.join('\n');
      if (ST.subMode === 'idm2') return makeIDMListWithNames(urls);
      return urls.join('\n');
    }

    if (ST.tab === 't66y') {
      const urls = ST.t66yLinks;
      if (!urls.length) return '（还没扫描到 23img/66img 链接）\n点上面的【扫描】';
      return urls.join('\n');
    }

    if (ST.tab === 'ymawv') {
      const urls = Array.from(ST.ymawvSet);
      if (!urls.length) {
        return [
          '（还没抓到 tu.ymawv 或 23img/66img 真图）',
          '',
          '提示：',
          '1) sehuatang/dmn12：先点开图片/滚动，让页面发请求。',
          '2) 也可以点【扫描DOM】再试。',
          '3) 有验证的链接，点【打开当前行】一眼就知道要人工过验证码。'
        ].join('\n');
      }
      return formatYmawvOutput(urls, { group: ST.yGroupByHost, markVerify: ST.yMarkVerify });
    }

    return '';
  }

  function getMetaLine() {
    if (ST.tab === 'univ') {
      const verifyCount = ST.univUrls.reduce((a,u)=>a+(isLikelyHumanVerifyUrl(u)?1:0),0);
      return `通用直链：${ST.univUrls.length} | 模式：${ST.subMode} | BG：${ST.useComputedBG ? '计算样式' : '内联'}${verifyCount?` | ⚠疑似验证：${verifyCount}`:''}`;
    }
    if (ST.tab === 't66y') {
      return `t66y：${ST.t66yLinks.length} | 只楼主：${ST.onlyOP ? '是' : '否'} | 下载=逐个触发(适配iOS)`;
    }
    if (ST.tab === 'ymawv') {
      const arr = Array.from(ST.ymawvSet);
      const verifyCount = arr.reduce((a,u)=>a+(isLikelyHumanVerifyUrl(u)?1:0),0);
      const pfx = (ST.yVerifyPrefix || '').replace(/\s+/g,' ').slice(0, 18);
      return `tu.ymawv抓取：${arr.length}${verifyCount?` | ⚠疑似验证：${verifyCount}`:''} | 分组：${ST.yGroupByHost?'开':'关'} | 标注：${ST.yMarkVerify?'开':'关'} | 前缀：${pfx ? JSON.stringify(pfx) : '(空)'}${needNetHook ? ' | 已启用网络拦截' : ' |（非sehuatang/dmn12仅DOM扫描）'}`;
    }
    return '';
  }

  function setActiveTab(tab) {
    ST.tab = tab;
    renderPanel();
  }

  function setSubMode(mode) {
    ST.subMode = mode;
    renderPanel();
  }

  function refreshCurrentTab() {
    if (ST.tab === 'univ') {
      ST.univUrls = collectImageUrls();
      logLine(`🔄 通用刷新：${ST.univUrls.length} 张`);
    } else if (ST.tab === 't66y') {
      if (!isT66Y) logLine('ℹ️ 当前不是 t66y 页面，但仍可手动扫描（可能抓不到）');
      ST.t66yLinks = extractT66YLinks(ST.onlyOP);
      logLine(`🔎 t66y 扫描：${ST.t66yLinks.length} 条（只楼主=${ST.onlyOP?'是':'否'}）`);
    } else if (ST.tab === 'ymawv') {
      addYmawvHits(document.documentElement?.outerHTML || '');
      logLine('🔎 tu.ymawv 扫描DOM 完成');
    }
    renderPanel();
  }

  function copyText(s) {
    try { GM_setClipboard(s); return true; } catch { return false; }
  }

  function getSelectedText(textarea) {
    try {
      const s = textarea.selectionStart ?? 0;
      const e = textarea.selectionEnd ?? 0;
      if (e > s) return textarea.value.slice(s, e);
    } catch {}
    return '';
  }

  function selectAllText(textarea) {
    try {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
    } catch {}
  }

  function getCurrentLine(textarea) {
    try {
      const pos = textarea.selectionStart ?? 0;
      const v = textarea.value || '';
      let start = v.lastIndexOf('\n', pos - 1);
      start = start === -1 ? 0 : start + 1;
      let end = v.indexOf('\n', pos);
      end = end === -1 ? v.length : end;
      return v.slice(start, end).trim();
    } catch {}
    return '';
  }

  function extractFirstUrlFromText(line) {
    if (!line) return '';
    const m = line.match(/https?:\/\/[^\s\t]+/i);
    return m ? m[0] : '';
  }

  function mountPanel() {
    if ($('#onePanel')) return true;
    if (!document.body) return false;

    const btn = document.createElement('div');
    btn.id = 'onePanelBtn';
    btn.textContent = '图床工具';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'onePanel';
    panel.innerHTML = `
      <header>
        <div class="title">图床终极合并版（单面板）</div>
        <div class="actions">
          <button id="btnRefresh">刷新</button>
          <button id="btnClose">关闭</button>
        </div>
      </header>

      <div class="tabs">
        <div class="tab" data-tab="univ">通用直链</div>
        <div class="tab" data-tab="t66y">t66y 全下</div>
        <div class="tab" data-tab="ymawv">tu.ymawv 抓取</div>
      </div>

      <div class="subtabs" id="subtabs">
        <div class="subtab" data-mode="urls">URL</div>
        <div class="subtab" data-mode="shortcuts">iOS快捷指令</div>
        <div class="subtab" data-mode="aria2">aria2</div>
        <div class="subtab" data-mode="idm">IDM(纯URL)</div>
        <div class="subtab" data-mode="idm2">IDM(URL+文件名)</div>
      </div>

      <div class="tools" id="tools"></div>

      <textarea id="oneTA" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea>

      <footer>
        <div class="meta" id="metaLine">未加载</div>
        <div class="btns">
          <button id="btnBgToggle" class="secondary">BG: 内联</button>
          <button id="btnSelectAll" class="secondary">全选</button>
          <button id="btnCopySel" class="secondary">复制选中</button>
          <button id="btnCopyLine" class="secondary">复制当前行</button>
          <button id="btnOpenLine" class="secondary">打开当前行</button>
          <button id="btnCopyAll">复制当前</button>
        </div>
      </footer>

      <div id="oneLog"></div>
    `;
    document.body.appendChild(panel);

    const ta = $('#oneTA', panel);

    // iOS：允许拖动选择，但阻止编辑输入
    ta.setAttribute('inputmode', 'none');
    ta.readOnly = false;
    ta.addEventListener('beforeinput', (e) => e.preventDefault());
    ta.addEventListener('keydown', (e) => {
      const blocked = e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key);
      if (blocked) e.preventDefault();
    });

    // 点文本框默认全选（解决 iOS 难拖选）
    ta.addEventListener('click', () => {
      if (!ta.value) return;
      selectAllText(ta);
    });

    btn.onclick = () => {
      panel.style.display = 'block';
      if (!ST.log.length) refreshCurrentTab();
      else renderPanel();
    };

    $('#btnClose', panel).onclick = () => { panel.style.display = 'none'; };
    $('#btnRefresh', panel).onclick = () => refreshCurrentTab();

    // Tabs
    $$('.tab', panel).forEach(t => {
      t.onclick = () => setActiveTab(t.dataset.tab);
    });

    // Subtabs（仅通用显示）
    $$('.subtab', panel).forEach(t => {
      t.onclick = () => setSubMode(t.dataset.mode);
    });

    // Bottom common buttons
    $('#btnSelectAll', panel).onclick = () => selectAllText(ta);
    $('#btnCopySel', panel).onclick = () => {
      const s = getSelectedText(ta);
      if (!s) return alert('未选中任何内容');
      alert(copyText(s) ? '已复制选中内容' : '复制失败');
    };
    $('#btnCopyLine', panel).onclick = () => {
      const line = getCurrentLine(ta);
      if (!line) return alert('未定位到当前行');
      alert(copyText(line) ? '已复制当前行' : '复制失败');
    };
    $('#btnOpenLine', panel).onclick = () => {
      const line = getCurrentLine(ta);
      const url = extractFirstUrlFromText(line);
      if (!url) return alert('当前行没有 URL');
      const likelyVerify = isLikelyHumanVerifyUrl(url);
      const w = window.open(url, '_blank');
      if (!w) location.href = url;
      if (likelyVerify) alert('⚠ 该链接疑似需要真人验证/挑战。\n已为你打开：先通过验证，再保存/复制真图链接。');
    };
    $('#btnCopyAll', panel).onclick = () => {
      alert(copyText(ta.value) ? '已复制当前内容' : '复制失败');
    };

    // BG toggle（仅通用有意义）
    $('#btnBgToggle', panel).onclick = () => {
      ST.useComputedBG = !ST.useComputedBG;
      logLine(`BG 开关：${ST.useComputedBG ? '计算样式' : '内联'}`);
      if (ST.tab === 'univ') refreshCurrentTab();
      else renderPanel();
    };

    renderPanel();
    return true;
  }

  function renderPanel() {
    const panel = $('#onePanel');
    if (!panel) return;

    // tabs active
    $$('.tab', panel).forEach(t => t.classList.toggle('active', t.dataset.tab === ST.tab));

    // subtabs show/hide
    const subtabs = $('#subtabs', panel);
    subtabs.style.display = (ST.tab === 'univ') ? 'flex' : 'none';
    $$('.subtab', panel).forEach(t => t.classList.toggle('active', t.dataset.mode === ST.subMode));

    // tools area depends on tab
    const tools = $('#tools', panel);
    tools.innerHTML = '';

    if (ST.tab === 'univ') {
      const btn1 = document.createElement('button');
      btn1.className = 'secondary';
      btn1.textContent = '说明';
      btn1.onclick = () => alert('通用：抓 img/srcset/data-src + (可选)background-image。\n若图片链接需要防盗链，推荐用 aria2 模式（自带 referer）。');
      tools.appendChild(btn1);
    }

    if (ST.tab === 't66y') {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="checkbox" ${ST.onlyOP ? 'checked' : ''}>只抓楼主`;
      lab.querySelector('input').onchange = (e) => {
        ST.onlyOP = !!e.target.checked;
        logLine(`t66y 只抓楼主：${ST.onlyOP ? '是' : '否'}`);
        refreshCurrentTab();
      };
      tools.appendChild(lab);

      const bScan = document.createElement('button');
      bScan.className = 'secondary';
      bScan.textContent = '扫描';
      bScan.onclick = () => refreshCurrentTab();
      tools.appendChild(bScan);

      const bCopy = document.createElement('button');
      bCopy.className = 'secondary';
      bCopy.textContent = '复制链接';
      bCopy.onclick = () => {
        const txt = (ST.t66yLinks || []).join('\n');
        if (!txt) return alert('还没有链接：先点扫描');
        alert(copyText(txt) ? `已复制 ${ST.t66yLinks.length} 条` : '复制失败');
      };
      tools.appendChild(bCopy);

      const bDown = document.createElement('button');
      bDown.className = 'primary';
      bDown.textContent = '全部下载';
      bDown.onclick = async () => {
        if (!ST.t66yLinks.length) refreshCurrentTab();
        if (!ST.t66yLinks.length) return alert('没扫到 23img/66img 链接');
        await runT66YQueue(ST.t66yLinks);
      };
      tools.appendChild(bDown);
    }

    if (ST.tab === 'ymawv') {
      // 分组输出
      const labGroup = document.createElement('label');
      labGroup.innerHTML = `<input type="checkbox" ${ST.yGroupByHost ? 'checked' : ''}>按域名分组`;
      labGroup.querySelector('input').onchange = (e) => {
        ST.yGroupByHost = !!e.target.checked;
        logLine(`tu.ymawv 分组输出：${ST.yGroupByHost ? '开' : '关'}`);
        renderPanel();
      };
      tools.appendChild(labGroup);

      // 标注疑似验证
      const labMark = document.createElement('label');
      labMark.innerHTML = `<input type="checkbox" ${ST.yMarkVerify ? 'checked' : ''}>标注疑似验证`;
      labMark.querySelector('input').onchange = (e) => {
        ST.yMarkVerify = !!e.target.checked;
        logLine(`tu.ymawv 标注验证：${ST.yMarkVerify ? '开' : '关'}`);
        renderPanel();
      };
      tools.appendChild(labMark);

      // ✅ A 方案：设置前缀（记住）
      const showPfx = (ST.yVerifyPrefix || '').replace(/\s+/g,' ').slice(0, 10);
      const bPrefix = document.createElement('button');
      bPrefix.className = 'secondary';
      bPrefix.textContent = `设置前缀（当前：${showPfx ? JSON.stringify(showPfx) : '(空)'}）`;
      bPrefix.onclick = () => {
        const v = prompt(
          '输入“疑似验证链接”前缀（例如：【需验证码】 ）\n留空=不加前缀（只会标注开关生效）',
          ST.yVerifyPrefix || ''
        );
        if (v === null) return; // 取消
        ST.yVerifyPrefix = String(v);
        safeSetLS('__onepanel_verify_prefix__', ST.yVerifyPrefix);
        logLine(`tu.ymawv 验证前缀已设置为：${ST.yVerifyPrefix ? JSON.stringify(ST.yVerifyPrefix) : '(空)'}`);
        renderPanel();
      };
      tools.appendChild(bPrefix);

      const bScan = document.createElement('button');
      bScan.className = 'secondary';
      bScan.textContent = '扫描DOM';
      bScan.onclick = () => {
        addYmawvHits(document.documentElement?.outerHTML || '');
        logLine('🔎 tu.ymawv 扫描DOM 完成');
      };
      tools.appendChild(bScan);

      // 复制纯URL（不带分组标题/不带前缀）
      const bCopyPure = document.createElement('button');
      bCopyPure.className = 'secondary';
      bCopyPure.textContent = '复制纯URL';
      bCopyPure.onclick = () => {
        const arr = Array.from(ST.ymawvSet);
        if (!arr.length) return alert('还没抓到链接：先滚动/点开图片/等几秒，再点扫描DOM');
        alert(copyText(arr.join('\n')) ? `已复制 ${arr.length} 条（纯URL）` : '复制失败');
      };
      tools.appendChild(bCopyPure);

      const bCarousel = document.createElement('button');
      bCarousel.className = 'primary';
      bCarousel.textContent = '单标签轮播打开';
      bCarousel.onclick = async () => {
        const arr = Array.from(ST.ymawvSet);
        if (!arr.length) return alert('还没抓到链接');
        await openCarouselOneTab(arr, 2200);
      };
      tools.appendChild(bCarousel);

      const bClear = document.createElement('button');
      bClear.className = 'secondary';
      bClear.textContent = '清空';
      bClear.onclick = () => {
        ST.ymawvSet.clear();
        logLine('🧹 已清空 tu.ymawv 列表');
        renderPanel();
      };
      tools.appendChild(bClear);
    }

    // textarea content
    const ta = $('#oneTA', panel);
    ta.value = getCurrentOutputText();

    // meta
    $('#metaLine', panel).textContent = getMetaLine();

    // bg button label
    $('#btnBgToggle', panel).textContent = ST.useComputedBG ? 'BG: 计算样式' : 'BG: 内联';

    // log
    $('#oneLog', panel).textContent = ST.log.join('\n');
    const logEl = $('#oneLog', panel);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /********************************************************************
   * 启动
   ********************************************************************/
  (async () => {
    injectNetHook(); // 越早越好

    for (let i = 0; i < 60; i++) {
      if (mountPanel()) break;
      await sleep(200);
    }

    logLine(`✅ 已加载单面板合并脚本 v4.3.0（${location.hostname}）`);
    if (needNetHook) logLine('✅ 已启用 sehuatang/dmn12 网络拦截（抓 tu.ymawv 真图）');
    if (isT66Y) logLine('✅ 当前为 t66y 页面：可用“t66y 全下”标签');
  })();

})();