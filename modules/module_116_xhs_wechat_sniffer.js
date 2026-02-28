// ==UserScript==
// @name         XHS专攻 + XHS/B站/公众号 嗅探 合并版（Stay/iOS Safari）
// @namespace    https://staybrowser.com/
// @version      0.2.6
// @description  合并增强版：小红书专攻 + XHS/B站/公众号嗅探（v0.2.6 公众号仅保留可直开音视频链接模式，含轻量修复）。
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/* ========= 模块A：小红书专攻版（仅 xiaohongshu.com 运行） ========= */
(function () {
  'use strict';
  if (!/xiaohongshu\.com/i.test(location.host)) return;

  const CFG = {
    PANEL_ID: '__xhs_pro_v21_panel__',
    STORE_KEY: '__xhs_pro_v21_store__',
    MAX_ITEMS: 2000,
    VERIFY_PREFIX: '⚠VERIFY',
    LONGPRESS_MS: 450,
    IMG_SUFFIX: '?imageView2/2/w/0/format/jpg',
    AUTO_REDIRECT_EXPLORE: true,
  };

  const S = {
    list: [],
    dedupe: new Set(),
    routeKey: location.href,
    panelReady: false,
    collapsed: false,
    filterText: '',
    filterType: 'all',
    verifyOnly: false,
    seqVideo: 1,
    seqImg: 1,
    imageCursorUrl: '',
    meta: {
      noteId: '',
      author: '',
      title: '',
      resolution: '',
      originVideoKey: '',
      lastVideoUrl: '',
      pageType: '',
      xsecToken: ''
    }
  };

  /********************
   * 路由：/explore -> /discovery/item
   ********************/
  (function redirectExploreToDiscovery() {
    if (!CFG.AUTO_REDIRECT_EXPLORE) return;
    try {
      const u = new URL(location.href);
      if (!/xiaohongshu\.com$/i.test(u.hostname) && !/\.xiaohongshu\.com$/i.test(u.hostname)) return;
      if (!u.pathname.startsWith('/explore/')) return;
      if (u.searchParams.get('xhs_opened') === '1') return;

      const m = u.pathname.match(/^\/explore\/([a-zA-Z0-9]+)/);
      if (!m) return;
      const noteId = m[1];

      const n = new URL(u.toString());
      n.pathname = `/discovery/item/${noteId}`;
      n.searchParams.set('xhs_opened', '1');
      location.replace(n.toString());
    } catch {}
  })();

  /********************
   * 工具
   ********************/
  function now() { return Date.now(); }

  function safeText(v) {
    return String(v ?? '').replace(/\s+/g, ' ').trim();
  }

  function decodeEscaped(s) {
    try { return JSON.parse(`"${s}"`); } catch { return s; }
  }

  function cleanTitle(t = '') {
    let s = safeText(t);
    s = s.replace(/\s*[-|｜]\s*小红书.*$/i, '');
    s = s
      .replace(/#[^#\s]{1,40}#/g, ' ')
      .replace(/#[^\s#]{1,40}/g, ' ')
      .replace(/\[[^\]]{1,40}\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s || 'xhs';
  }

  function cleanAuthor(a = '') {
    let s = safeText(a);
    s = s.replace(/关注$/g, '').trim();
    return s || 'author';
  }

  function sanitizeName(s = '') {
    return String(s)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'xhs';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function hostOf(url = '') {
    try { return new URL(url).host; } catch { return ''; }
  }

  function extOf(url = '') {
    try {
      const p = new URL(url, location.href).pathname.toLowerCase();
      const m = p.match(/\.([a-z0-9]{2,6})$/);
      return m ? m[1] : '';
    } catch { return ''; }
  }

  function cleanUrl(raw = '') {
    try {
      const u = new URL(raw, location.href);
      [
        'utm_source','utm_medium','utm_campaign','spm','from',
        'share_from_user_hidden','xhs_share_source','appuid',
        'xhsshare','shareRedId','apptime','share_id'
      ].forEach(k => u.searchParams.delete(k));
      return u.toString();
    } catch { return raw; }
  }

  function isHttp(url = '') {
    return /^https?:\/\//i.test(url);
  }

  function isVerifyLike(url = '') {
    return /verify|captcha|challenge|token=|sign=|auth|expires=|xsec_|xsec_token|download_token/i.test(url);
  }

  function guessType(url = '', ct = '') {
    const s = `${url} ${ct}`.toLowerCase();
    if (/m3u8|application\/vnd\.apple\.mpegurl|application\/x-mpegurl/.test(s)) return 'm3u8';
    if (/video|mp4|mov|m4v|webm/.test(s)) return 'video';
    if (/image|jpg|jpeg|png|webp|gif|avif|xhscdn/.test(s)) return 'image';
    return 'other';
  }

  function shouldCatch(url = '', ct = '') {
    const s = `${url} ${ct}`.toLowerCase();
    return (
      /xhscdn\.com/.test(s) ||
      /originvideokey|masterurl|h265url/.test(s) ||
      /\.(mp4|m3u8|jpg|jpeg|png|webp|gif|avif)(\?|#|$)/.test(s) ||
      /video|image|stream|media/.test(s)
    );
  }

  function normalizeXhsImageUrl(url = '') {
    try {
      let u = cleanUrl(url);
      if (!u) return u;
      u = u.replace(/!nd_[^/?#]+/gi, '');
      u = u.replace(/https?:\/\/sns-img-(?:qc|bh|db|hw)\.xhscdn\.com/i, 'https://sns-img-hw.xhscdn.com');
      const obj = new URL(u);
      obj.search = '';
      obj.hash = '';
      return obj.toString() + CFG.IMG_SUFFIX;
    } catch {
      return url;
    }
  }

  function inferFilename(item) {
    const author = sanitizeName(S.meta.author || item.author || 'author');
    const title = sanitizeName(S.meta.title || item.title || 'xhs');
    const res = sanitizeName(item.resolution || S.meta.resolution || (item.type === 'image' ? 'img' : 'video'));
    const seq = pad2(item.seq || 1);

    let ext = extOf(item.cleanUrl);
    if (item.type === 'image') ext = 'jpg';
    if (!ext) ext = item.type === 'm3u8' ? 'm3u8' : (item.type === 'video' ? 'mp4' : 'txt');

    return `${author}_${title}_${res}_${seq}.${ext}`;
  }

  function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function openUrl(url) {
    try { window.open(url, '_blank'); } catch { location.href = url; }
  }

  function persist() {
    try {
      sessionStorage.setItem(CFG.STORE_KEY, JSON.stringify({
        list: S.list.slice(0, 1200),
        seqVideo: S.seqVideo,
        seqImg: S.seqImg,
        meta: S.meta
      }));
    } catch {}
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(CFG.STORE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.list)) {
        S.list = obj.list;
        for (const it of S.list) S.dedupe.add(`${it.type}|${it.cleanUrl}`);
      }
      if (obj.seqVideo) S.seqVideo = obj.seqVideo;
      if (obj.seqImg) S.seqImg = obj.seqImg;
      if (obj.meta) S.meta = Object.assign(S.meta, obj.meta);
    } catch {}
  }

  /********************
   * v2.1 补丁函数
   ********************/
  function getOriginKeyCandidateUrl() {
    const k = (S.meta.originVideoKey || '').trim();
    if (!k) return '';
    if (/^https?:\/\//i.test(k)) return k;
    if (/^[\w./-]+$/.test(k)) return `https://sns-video-hw.xhscdn.com/${k}`;
    return '';
  }

  function tryCopyOriginKeyCandidate() {
    const u = getOriginKeyCandidateUrl();
    copyText(u || '(no candidate url)');
  }

  async function autoFlipAndRescanImages() {
    const clickOne = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          try { el.click(); return true; } catch {}
        }
      }
      return false;
    };

    const nextSelectors = [
      '.swiper-button-next',
      '.arrow.right',
      '.note-slider .right',
      '[class*="swiper"] [class*="next"]',
      '[class*="arrow"][class*="right"]',
      '[class*="carousel"] [aria-label*="下一"]',
      '[aria-label="Next"]'
    ];

    const prevSelectors = [
      '.swiper-button-prev',
      '.arrow.left',
      '.note-slider .left',
      '[class*="swiper"] [class*="prev"]',
      '[class*="arrow"][class*="left"]',
      '[class*="carousel"] [aria-label*="上一"]',
      '[aria-label="Previous"]'
    ];

    scanDomMedia();
    scanPerformance();
    setTimeout(scanNoteDetailMapAndScripts, 200);

    if (getAllImageItems().length > 0) {
      renderList();
      renderMeta();
      return;
    }

    const movedNext = clickOne(nextSelectors);
    if (movedNext) {
      await new Promise(r => setTimeout(r, 700));
      scanDomMedia();
      scanPerformance();
      scanNoteDetailMapAndScripts();
    }

    const movedPrev = clickOne(prevSelectors);
    if (movedPrev) {
      await new Promise(r => setTimeout(r, 700));
      scanDomMedia();
      scanPerformance();
      scanNoteDetailMapAndScripts();
    }

    setTimeout(() => {
      scanDomMedia();
      scanPerformance();
      scanNoteDetailMapAndScripts();
      renderMeta();
      renderList();
    }, 500);
  }

  /********************
   * 元数据提取
   ********************/
  function parseNoteIdAndTokenFromUrl() {
    try {
      const u = new URL(location.href);
      const m1 = u.pathname.match(/\/discovery\/item\/([a-zA-Z0-9]+)/);
      const m2 = u.pathname.match(/\/explore\/([a-zA-Z0-9]+)/);
      if (m1?.[1]) S.meta.noteId = m1[1];
      if (m2?.[1]) S.meta.noteId = m2[1];
      const xsec = u.searchParams.get('xsec_token');
      if (xsec) S.meta.xsecToken = xsec;
    } catch {}
  }

  function scanMetaBasics() {
    try {
      parseNoteIdAndTokenFromUrl();

      const t1 = document.querySelector('meta[property="og:title"]')?.content;
      const t2 = document.querySelector('meta[name="description"]')?.content;
      const t3 = document.title;
      const title = cleanTitle(t1 || t2 || t3 || '');
      if (title) S.meta.title = title;

      let author =
        document.querySelector('.author .name')?.textContent ||
        document.querySelector('.user-name')?.textContent ||
        document.querySelector('[class*="author"] [class*="name"]')?.textContent ||
        document.querySelector('[data-v-7eebd74c] .name')?.textContent ||
        '';

      if (!author) {
        const html = document.documentElement?.innerHTML || '';
        const m = html.match(/"nickname"\s*:\s*"([^"]+)"/);
        if (m?.[1]) author = decodeEscaped(m[1]);
      }
      if (author) S.meta.author = cleanAuthor(author);
    } catch {}
  }

  function scanResolutionHints() {
    try {
      const v = document.querySelector('video');
      if (v && v.videoWidth && v.videoHeight) {
        S.meta.resolution = `${v.videoWidth}x${v.videoHeight}`;
      }
      const html = document.documentElement?.innerHTML || '';
      const m = html.match(/"width"\s*:\s*(\d{2,5})\s*,\s*"height"\s*:\s*(\d{2,5})/);
      if (m?.[1] && m?.[2]) S.meta.resolution = `${m[1]}x${m[2]}`;
    } catch {}
  }

  /********************
   * 核心收集
   ********************/
  function addItem(raw) {
    try {
      if (!raw || !raw.url) return;
      let u = cleanUrl(raw.url);
      if (!isHttp(u)) return;

      const type = raw.type || guessType(u, raw.contentType || '');

      if (type === 'image') {
        u = normalizeXhsImageUrl(u);
      } else if (type === 'video') {
        S.meta.lastVideoUrl = u;
      }

      const key = `${type}|${u}`;
      if (S.dedupe.has(key)) return;
      S.dedupe.add(key);

      const item = {
        id: `${now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: now(),
        url: raw.url,
        cleanUrl: u,
        type,
        source: raw.source || 'unknown',
        contentType: raw.contentType || '',
        method: raw.method || 'GET',
        host: hostOf(u),
        ext: extOf(u),
        pageUrl: location.href,
        noteId: S.meta.noteId || '',
        title: S.meta.title || cleanTitle(document.title),
        author: S.meta.author || '',
        resolution: raw.resolution || (type === 'video' ? (S.meta.resolution || '') : ''),
      };

      if (type === 'video' || type === 'm3u8') item.seq = S.seqVideo++;
      if (type === 'image') item.seq = S.seqImg++;

      item.filename = inferFilename(item);

      S.list.unshift(item);
      if (S.list.length > CFG.MAX_ITEMS) S.list.length = CFG.MAX_ITEMS;

      persist();
      renderMeta();
      renderList();
    } catch {}
  }

  /********************
   * XHS JSON/HTML 注水解析
   ********************/
  function tryParseJSONLoose(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function walkObjectDeep(obj, visitor, seen = new WeakSet(), depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (const v of obj) walkObjectDeep(v, visitor, seen, depth + 1);
      return;
    }

    visitor(obj);

    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object') walkObjectDeep(v, visitor, seen, depth + 1);
    }
  }

  function extractFromObjectGraph(obj, source = 'json_obj') {
    try {
      walkObjectDeep(obj, (node) => {
        const keys = ['originVideoKey', 'masterUrl', 'h265Url', 'urlDefault', 'urlPre', 'url', 'backupUrl'];
        for (const k of keys) {
          if (!(k in node)) continue;
          const v = node[k];
          if (typeof v === 'string') {
            const s = decodeEscaped(v);
            if (/xhscdn|m3u8|mp4|image|video/i.test(s) || /^https?:\/\//i.test(s)) {
              if (k === 'originVideoKey') {
                S.meta.originVideoKey = s;
                if (/^https?:\/\//i.test(s)) addItem({ url: s, source: `${source}_originKey` });
                else if (/^[\w./-]+$/.test(s)) addItem({ url: `https://sns-video-hw.xhscdn.com/${s}`, source: `${source}_originKey_join` });
              } else {
                addItem({ url: s, source: `${source}_${k}` });
              }
            }
          } else if (Array.isArray(v)) {
            v.forEach((x) => {
              if (typeof x === 'string') addItem({ url: decodeEscaped(x), source: `${source}_${k}_arr` });
            });
          }
        }

        if (typeof node.width === 'number' && typeof node.height === 'number') {
          if (node.width > 100 && node.height > 100 && !S.meta.resolution) {
            S.meta.resolution = `${node.width}x${node.height}`;
          }
        }

        if (typeof node.nickname === 'string' && !S.meta.author) {
          S.meta.author = cleanAuthor(decodeEscaped(node.nickname));
        }
        if (typeof node.title === 'string' && !S.meta.title) {
          S.meta.title = cleanTitle(decodeEscaped(node.title));
        }
        if (typeof node.desc === 'string' && !S.meta.title) {
          S.meta.title = cleanTitle(decodeEscaped(node.desc));
        }

        if (typeof node.noteId === 'string' && !S.meta.noteId) S.meta.noteId = node.noteId;
        if (typeof node.note_id === 'string' && !S.meta.noteId) S.meta.noteId = node.note_id;
      });
    } catch {}
  }

  function scanNoteDetailMapAndScripts() {
    try {
      const html = document.documentElement?.innerHTML || '';
      if (!html) return;

      const directUrls = html.match(/https?:\/\/sns-(?:video|img)-(?:hw|bh|qc|db)\.xhscdn\.com\/[^\s"'<>\\]+/g) || [];
      directUrls.slice(0, 500).forEach(u => addItem({ url: decodeEscaped(u), source: 'html_xhscdn' }));

      const regexes = [
        /"originVideoKey"\s*:\s*"([^"]+)"/g,
        /"masterUrl"\s*:\s*"([^"]+)"/g,
        /"h265Url"\s*:\s*"([^"]+)"/g,
        /"urlDefault"\s*:\s*"([^"]+)"/g,
        /"urlPre"\s*:\s*"([^"]+)"/g,
        /"url"\s*:\s*"([^"]*xhscdn[^"]*)"/g,
        /"nickname"\s*:\s*"([^"]+)"/g,
        /"title"\s*:\s*"([^"]{1,200})"/g,
        /"desc"\s*:\s*"([^"]{1,300})"/g,
        /"noteId"\s*:\s*"([^"]+)"/g
      ];
      for (let i = 0; i < regexes.length; i++) {
        let m, c = 0;
        while ((m = regexes[i].exec(html)) && c < 200) {
          const v = decodeEscaped(m[1]);
          if (i === 0) {
            S.meta.originVideoKey = v;
            if (/^https?:\/\//i.test(v)) addItem({ url: v, source: 'html_originVideoKey' });
            else if (/^[\w./-]+$/.test(v)) addItem({ url: `https://sns-video-hw.xhscdn.com/${v}`, source: 'originVideoKey_join' });
          } else if (i <= 5) {
            addItem({ url: v, source: 'html_field' });
          } else if (i === 6 && !S.meta.author) {
            S.meta.author = cleanAuthor(v);
          } else if ((i === 7 || i === 8) && !S.meta.title) {
            S.meta.title = cleanTitle(v);
          } else if (i === 9 && !S.meta.noteId) {
            S.meta.noteId = v;
          }
          c++;
        }
      }

      const scripts = document.querySelectorAll('script');
      scripts.forEach((sc, idx) => {
        const txt = sc.textContent || '';
        if (!txt || txt.length < 20) return;

        const us = txt.match(/https?:\/\/sns-(?:video|img)-(?:hw|bh|qc|db)\.xhscdn\.com\/[^\s"'<>\\]+/g) || [];
        us.slice(0, 120).forEach(u => addItem({ url: decodeEscaped(u), source: `script_${idx}_url` }));

        const stateMatch = txt.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m);
        if (stateMatch?.[1]) {
          const obj = tryParseJSONLoose(stateMatch[1]);
          if (obj) extractFromObjectGraph(obj, `script_${idx}_initial`);
        }

        const ndm = txt.match(/"noteDetailMap"\s*:\s*(\{[\s\S]{50,200000}\})/);
        if (ndm?.[1]) {
          const maybe = '{' + `"noteDetailMap":${ndm[1]}`;
          const obj = tryParseJSONLoose(maybe);
          if (obj) extractFromObjectGraph(obj, `script_${idx}_noteDetailMap`);
        }

        if (/originVideoKey|xhscdn|imageList|noteDetailMap/i.test(txt)) {
          scanJsonLikeText(txt, `script_${idx}_grep`);
        }
      });

      const og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) addItem({ url: og, source: 'og_image' });

      renderMeta();
    } catch {}
  }

  function scanJsonLikeText(txt, source = 'json_like') {
    try {
      let m;
      const r1 = /"originVideoKey"\s*:\s*"([^"]+)"/g;
      while ((m = r1.exec(txt))) {
        const k = decodeEscaped(m[1]);
        S.meta.originVideoKey = k;
        if (/^https?:\/\//i.test(k)) addItem({ url: k, source });
        else if (/^[\w./-]+$/.test(k)) addItem({ url: `https://sns-video-hw.xhscdn.com/${k}`, source: `${source}_originKey` });
      }

      const r2 = /"(masterUrl|h265Url)"\s*:\s*"([^"]+)"/g;
      while ((m = r2.exec(txt))) addItem({ url: decodeEscaped(m[2]), source: `${source}_${m[1]}` });

      const r3 = /"(urlDefault|urlPre|url)"\s*:\s*"([^"]*sns-img-[^"]+)"/g;
      while ((m = r3.exec(txt))) addItem({ url: decodeEscaped(m[2]), source: `${source}_${m[1]}` });

      const us = txt.match(/https?:\/\/sns-(?:video|img)-(?:hw|bh|qc|db)\.xhscdn\.com\/[^\s"'<>\\]+/g) || [];
      us.slice(0, 200).forEach(u => addItem({ url: decodeEscaped(u), source: `${source}_xhscdn` }));

      const nick = txt.match(/"nickname"\s*:\s*"([^"]+)"/);
      if (nick?.[1] && !S.meta.author) S.meta.author = cleanAuthor(decodeEscaped(nick[1]));
      const title = txt.match(/"title"\s*:\s*"([^"]{1,200})"/) || txt.match(/"desc"\s*:\s*"([^"]{1,300})"/);
      if (title?.[1] && !S.meta.title) S.meta.title = cleanTitle(decodeEscaped(title[1]));
    } catch {}
  }

  /********************
   * DOM / Performance / Hook
   ********************/
  function scanDomMedia() {
    try {
      document.querySelectorAll('video').forEach(v => {
        const u = v.currentSrc || v.src;
        if (u) addItem({ url: u, source: 'video_tag' });
        if (v.videoWidth && v.videoHeight) S.meta.resolution = `${v.videoWidth}x${v.videoHeight}`;
      });

      document.querySelectorAll('source[src]').forEach(s => {
        const u = s.getAttribute('src');
        if (u) addItem({ url: u, source: 'source_tag' });
      });

      document.querySelectorAll('img[src],img[srcset]').forEach(img => {
        const u = img.currentSrc || img.getAttribute('src');
        if (u && /xhscdn\.com/i.test(u)) {
          addItem({ url: u, source: 'img_tag' });
          S.imageCursorUrl = u;
        }
      });
    } catch {}
  }

  function scanPerformance() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const e of entries) {
        const u = e?.name || '';
        if (u && shouldCatch(u)) addItem({ url: u, source: 'performance' });
      }
    } catch {}
  }

  (function hookFetch() {
    const _fetch = window.fetch;
    if (!_fetch) return;
    window.fetch = async function (...args) {
      let reqUrl = '', method = 'GET';
      try {
        const req = args[0];
        if (typeof req === 'string') reqUrl = req;
        else if (req && req.url) { reqUrl = req.url; method = req.method || 'GET'; }
      } catch {}
      if (reqUrl) addItem({ url: reqUrl, method, source: 'fetch_req' });

      const res = await _fetch.apply(this, args);
      try {
        const u = res?.url || reqUrl;
        const ct = res?.headers?.get?.('content-type') || '';
        if (shouldCatch(u, ct)) addItem({ url: u, method, contentType: ct, source: 'fetch_res' });

        if (/json/i.test(ct)) {
          res.clone().text().then((txt) => {
            if (txt && /originVideoKey|xhscdn|imageList|noteDetailMap/i.test(txt)) {
              scanJsonLikeText(txt, 'fetch_json');
            }
          }).catch(() => {});
        }
      } catch {}
      return res;
    };
  })();

  (function hookXHR() {
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__xhs_m = method || 'GET';
      this.__xhs_u = url || '';
      return rawOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      try {
        if (this.__xhs_u) addItem({ url: this.__xhs_u, method: this.__xhs_m, source: 'xhr_req' });
        this.addEventListener('load', () => {
          try {
            const u = this.responseURL || this.__xhs_u || '';
            const ct = this.getResponseHeader?.('content-type') || '';
            if (shouldCatch(u, ct)) addItem({ url: u, method: this.__xhs_m, contentType: ct, source: 'xhr_res' });

            const txt = typeof this.responseText === 'string' ? this.responseText : '';
            if (txt && /originVideoKey|xhscdn|imageList|noteDetailMap/i.test(txt)) {
              scanJsonLikeText(txt, 'xhr_json');
            }
          } catch {}
        });
      } catch {}
      return rawSend.apply(this, args);
    };
  })();

  /********************
   * 当前图 / 全部图
   ********************/
  function getAllImageItems() {
    const map = new Map();
    for (const it of S.list) {
      if (it.type !== 'image') continue;
      if (!map.has(it.cleanUrl)) map.set(it.cleanUrl, it);
    }
    return Array.from(map.values()).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  function getCurrentImageItem() {
    try {
      const candidates = Array.from(document.querySelectorAll('img[src],img[srcset]'));
      const visible = candidates
        .map(img => ({
          w: img.naturalWidth || img.width || 0,
          h: img.naturalHeight || img.height || 0,
          src: img.currentSrc || img.getAttribute('src') || ''
        }))
        .filter(x => /xhscdn\.com/i.test(x.src) && x.w >= 200 && x.h >= 200)
        .sort((a, b) => (b.w * b.h) - (a.w * a.h));

      if (visible[0]?.src) {
        const cur = normalizeXhsImageUrl(visible[0].src);
        const hit = S.list.find(x => x.type === 'image' && x.cleanUrl === cur);
        if (hit) return hit;
        addItem({ url: visible[0].src, source: 'current_img_dom' });
        const hit2 = S.list.find(x => x.type === 'image' && x.cleanUrl === cur);
        if (hit2) return hit2;
      }
    } catch {}

    try {
      const cur = normalizeXhsImageUrl(S.imageCursorUrl || '');
      if (cur) {
        const hit = S.list.find(x => x.type === 'image' && x.cleanUrl === cur);
        if (hit) return hit;
      }
    } catch {}

    return S.list.find(x => x.type === 'image') || null;
  }

  /********************
   * UI
   ********************/
  function ensurePanel() {
    if (document.getElementById(CFG.PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = CFG.PANEL_ID;
    panel.innerHTML = `
<style>
#${CFG.PANEL_ID}{
  position:fixed; z-index:2147483647; right:8px; bottom:8px; width:368px; max-width:calc(100vw - 16px);
  background:rgba(18,18,20,.96); color:#f2f2f3; border:1px solid #333; border-radius:12px;
  box-shadow:0 8px 28px rgba(0,0,0,.35); font:12px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
#${CFG.PANEL_ID}.collapsed .xb-body{display:none;}
#${CFG.PANEL_ID} .xb-head{padding:8px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid #2f2f33; user-select:none; -webkit-user-select:none;}
#${CFG.PANEL_ID} .xb-title{font-weight:700; font-size:13px;}
#${CFG.PANEL_ID} .xb-sub{font-size:10px; color:#bdbdc6; margin-top:2px;}
#${CFG.PANEL_ID} button,#${CFG.PANEL_ID} select,#${CFG.PANEL_ID} input{
  border:1px solid #3a3a40; background:#26262b; color:#f2f2f3; border-radius:8px; font-size:11px; padding:6px 8px;
}
#${CFG.PANEL_ID} .xb-head button{padding:5px 8px;}
#${CFG.PANEL_ID} .xb-body{padding:8px;}
#${CFG.PANEL_ID} .row{display:flex; gap:6px; margin-bottom:6px;}
#${CFG.PANEL_ID} .row>*{flex:1; min-width:0;}
#${CFG.PANEL_ID} .fit{flex:0 0 auto;}
#${CFG.PANEL_ID} .warn{border:1px solid #6b3434; background:#2a1c1d; color:#ffd6d8; border-radius:10px; padding:6px; margin-bottom:6px; font-size:10px; line-height:1.35;}
#${CFG.PANEL_ID} .meta{border:1px solid #2f2f33; border-radius:10px; background:#1f1f23; padding:6px; margin-bottom:6px; font-size:10px; color:#cfcfd6; line-height:1.35;}
#${CFG.PANEL_ID} .meta b{color:#fff;}
#${CFG.PANEL_ID} .stats{font-size:10px; color:#bdbdc6; margin:2px 0 6px;}
#${CFG.PANEL_ID} .list{max-height:46vh; overflow:auto; display:flex; flex-direction:column; gap:6px;}
#${CFG.PANEL_ID} .item{border:1px solid #303036; border-radius:10px; background:#1e1e22; padding:7px;}
#${CFG.PANEL_ID} .item.verify{border-color:#6b3434;}
#${CFG.PANEL_ID} .tags{display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px;}
#${CFG.PANEL_ID} .tag{border:1px solid #3b3b42; color:#bdbdc6; border-radius:999px; padding:1px 6px; font-size:10px; background:#26262c;}
#${CFG.PANEL_ID} .tag.video{color:#b7e0ff;}
#${CFG.PANEL_ID} .tag.image{color:#ffd7a3;}
#${CFG.PANEL_ID} .tag.m3u8{color:#d5ffb7;}
#${CFG.PANEL_ID} .name{font-size:11px; color:#f2f2f3; word-break:break-all; margin-bottom:4px;}
#${CFG.PANEL_ID} .url{font-size:10px; color:#bdbdc6; word-break:break-all; max-height:3.9em; overflow:hidden;}
#${CFG.PANEL_ID} .ops{display:flex; gap:5px; margin-top:6px;}
#${CFG.PANEL_ID} .ops button{flex:1; padding:5px 6px;}
</style>
<div class="xb-head">
  <div>
    <div class="xb-title">小红书专攻 v2.1</div>
    <div class="xb-sub" id="xhsMini">0条</div>
  </div>
  <div style="display:flex;gap:6px;">
    <button id="xhsToggle">收起</button>
    <button id="xhsClose">×</button>
  </div>
</div>
<div class="xb-body">
  <div class="warn" id="xhsWarn">视频下载不了时，先看这里的 originVideoKey（有些笔记会鉴权/防盗链）。</div>
  <div class="meta" id="xhsMeta">读取中...</div>

  <div class="row">
    <input id="xhsFilter" placeholder="过滤：mp4 / xhscdn / 标题" />
    <select id="xhsType" class="fit">
      <option value="all">全部</option>
      <option value="video">视频</option>
      <option value="m3u8">m3u8</option>
      <option value="image">图片</option>
    </select>
  </div>

  <div class="row">
    <button id="xhsVerifyOnly" class="fit">仅VERIFY:关</button>
    <button id="xhsOnlyVideo" class="fit">仅视频</button>
    <button id="xhsOnlyImg" class="fit">仅图片</button>
  </div>

  <div class="row">
    <button id="xhsCurrentImg">当前图</button>
    <button id="xhsAllImgs">全部图</button>
    <button id="xhsCopyOriginKey">Key</button>
    <button id="xhsKeyUrl">Key→URL</button>
  </div>

  <div class="row">
    <button id="xhsVideoState">视频状态</button>
    <button id="xhsCopyAll">复制全部URL</button>
    <button id="xhsExport">导出文本</button>
    <button id="xhsClear">清空</button>
  </div>

  <div class="row">
    <button id="xhsShortcutTxt">快捷指令文本</button>
    <button id="xhsAria2">aria2</button>
    <button id="xhsFFmpeg">ffmpeg</button>
  </div>

  <div class="row">
    <button id="xhsRefresh">重扫</button>
  </div>

  <div class="stats" id="xhsStats">0条</div>
  <div class="list" id="xhsList"></div>
</div>`;
    document.documentElement.appendChild(panel);

    const $ = (s) => panel.querySelector(s);
    const refs = {
      panel,
      mini: $('#xhsMini'),
      toggle: $('#xhsToggle'),
      close: $('#xhsClose'),
      warn: $('#xhsWarn'),
      meta: $('#xhsMeta'),
      filter: $('#xhsFilter'),
      type: $('#xhsType'),
      verifyOnly: $('#xhsVerifyOnly'),
      onlyVideo: $('#xhsOnlyVideo'),
      onlyImg: $('#xhsOnlyImg'),
      currentImg: $('#xhsCurrentImg'),
      allImgs: $('#xhsAllImgs'),
      copyOriginKey: $('#xhsCopyOriginKey'),
      keyUrl: $('#xhsKeyUrl'),
      videoState: $('#xhsVideoState'),
      copyAll: $('#xhsCopyAll'),
      export: $('#xhsExport'),
      clear: $('#xhsClear'),
      shortcutTxt: $('#xhsShortcutTxt'),
      aria2: $('#xhsAria2'),
      ffmpeg: $('#xhsFFmpeg'),
      refresh: $('#xhsRefresh'),
      stats: $('#xhsStats'),
      list: $('#xhsList')
    };
    panel.__refs = refs;

    refs.toggle.addEventListener('click', () => {
      S.collapsed = !S.collapsed;
      panel.classList.toggle('collapsed', S.collapsed);
      refs.toggle.textContent = S.collapsed ? '展开' : '收起';
    });
    refs.close.addEventListener('click', () => panel.remove());

    refs.filter.addEventListener('input', () => { S.filterText = refs.filter.value.trim().toLowerCase(); renderList(); });
    refs.type.addEventListener('change', () => { S.filterType = refs.type.value; renderList(); });

    refs.verifyOnly.addEventListener('click', () => {
      S.verifyOnly = !S.verifyOnly;
      refs.verifyOnly.textContent = `仅VERIFY:${S.verifyOnly ? '开' : '关'}`;
      renderList();
    });

    refs.onlyVideo.addEventListener('click', () => { refs.type.value = 'video'; S.filterType = 'video'; renderList(); });
    refs.onlyImg.addEventListener('click', () => { refs.type.value = 'image'; S.filterType = 'image'; renderList(); });

    refs.currentImg.addEventListener('click', async () => {
      let it = getCurrentImageItem();
      if (!it) {
        await autoFlipAndRescanImages();
        it = getCurrentImageItem();
      }
      copyText(it ? it.cleanUrl : '(no image)');
    });

    refs.allImgs.addEventListener('click', async () => {
      let arr = getAllImageItems();
      if (!arr.length) {
        await autoFlipAndRescanImages();
        arr = getAllImageItems();
      }
      copyText(arr.length ? arr.map(x => x.cleanUrl).join('\n') : '(no images)');
    });

    refs.copyOriginKey.addEventListener('click', () => copyText(S.meta.originVideoKey || '(none)'));
    refs.keyUrl.addEventListener('click', () => tryCopyOriginKeyCandidate());

    refs.videoState.addEventListener('click', () => {
      const hasPlayable = S.list.some(x => x.type === 'video' || x.type === 'm3u8');
      const hasKey = !!(S.meta.originVideoKey || '').trim();
      const state = hasPlayable ? '已就绪' : (hasKey ? '未就绪（key已抓到）' : '未就绪');
      const cand = getOriginKeyCandidateUrl();
      copyText([
        `视频状态=${state}`,
        `originVideoKey=${S.meta.originVideoKey || '(none)'}`,
        `candidate=${cand || '(none)'}`,
        `noteId=${S.meta.noteId || '(none)'}`
      ].join('\n'));
    });

    refs.copyAll.addEventListener('click', () => copyText(getFiltered().map(x => x.cleanUrl).join('\n')));

    refs.export.addEventListener('click', () => {
      const txt = getFiltered().map((x, i) => {
        const u = isVerifyLike(x.cleanUrl) ? `${CFG.VERIFY_PREFIX} ${x.cleanUrl}` : x.cleanUrl;
        return `${i + 1}. [${x.type}] [${x.source}] ${x.filename}\n${u}`;
      }).join('\n\n');
      copyText(txt);
    });

    refs.shortcutTxt.addEventListener('click', () => {
      const txt = getFiltered().map((x) => [
        `TYPE=${x.type}`,
        `NAME=${x.filename}`,
        `URL=${x.cleanUrl}`,
        `REFERER=${x.pageUrl || location.href}`,
        `VERIFY=${isVerifyLike(x.cleanUrl) ? '1' : '0'}`
      ].join('\n')).join('\n\n---\n\n');
      copyText(txt);
    });

    refs.clear.addEventListener('click', () => {
      S.list = [];
      S.dedupe.clear();
      S.seqVideo = 1;
      S.seqImg = 1;
      persist();
      renderMeta();
      renderList();
    });

    refs.aria2.addEventListener('click', () => {
      const txt = getFiltered().map(x =>
        `${x.cleanUrl}\n  out=${x.filename}\n  header=Referer: ${x.pageUrl || location.href}`
      ).join('\n');
      copyText(txt);
    });

    refs.ffmpeg.addEventListener('click', () => {
      const txt = getFiltered().filter(x => x.type === 'm3u8' || x.type === 'video').map(x => {
        if (x.type === 'm3u8') {
          const base = x.filename.replace(/\.m3u8$/i, '').replace(/\.mp4$/i, '');
          return `ffmpeg -headers "Referer: ${x.pageUrl || location.href}\\r\\n" -i "${x.cleanUrl}" -c copy "${base}.mp4"`;
        }
        return `# 直链视频（可直接打开/下载）\n${x.cleanUrl}`;
      }).join('\n');
      copyText(txt);
    });

    refs.refresh.addEventListener('click', () => fullRescan());

    let t = null;
    panel.querySelector('.xb-head').addEventListener('touchstart', () => {
      clearTimeout(t);
      t = setTimeout(() => refs.toggle.click(), CFG.LONGPRESS_MS);
    }, { passive: true });
    panel.querySelector('.xb-head').addEventListener('touchend', () => clearTimeout(t), { passive: true });
    panel.querySelector('.xb-head').addEventListener('touchcancel', () => clearTimeout(t), { passive: true });

    S.panelReady = true;
    renderMeta();
    renderList();
  }

  function getFiltered() {
    let arr = S.list.slice();
    if (S.filterType !== 'all') arr = arr.filter(x => x.type === S.filterType);
    if (S.verifyOnly) arr = arr.filter(x => isVerifyLike(x.cleanUrl));
    if (S.filterText) {
      const kw = S.filterText;
      arr = arr.filter(x =>
        (x.cleanUrl || '').toLowerCase().includes(kw) ||
        (x.filename || '').toLowerCase().includes(kw) ||
        (x.source || '').toLowerCase().includes(kw) ||
        (x.title || '').toLowerCase().includes(kw)
      );
    }
    arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return arr;
  }

  function renderMeta() {
    if (!S.panelReady) return;
    const refs = document.getElementById(CFG.PANEL_ID)?.__refs;
    if (!refs) return;

    const hasPlayable = S.list.some(x => x.type === 'video' || x.type === 'm3u8');
    const hasKey = !!(S.meta.originVideoKey || '').trim();
    const cand = getOriginKeyCandidateUrl();

    let statusText = '视频状态：未就绪';
    if (hasPlayable) statusText = '视频状态：已就绪';
    else if (hasKey) statusText = '视频状态：未就绪（已抓到 originVideoKey）';

    refs.warn.textContent = hasKey
      ? `${statusText} ｜ originVideoKey 已抓到（下载失败可排查）`
      : `${statusText} ｜ 还没抓到 originVideoKey（可点“重扫”或播放一次视频再试）`;

    refs.meta.innerHTML =
      `<div><b>noteId:</b> ${escapeHtml(S.meta.noteId || '(none)')}</div>` +
      `<div><b>xsec_token:</b> ${escapeHtml(S.meta.xsecToken ? S.meta.xsecToken.slice(0, 18) + '…' : '(none)')}</div>` +
      `<div><b>作者:</b> ${escapeHtml(S.meta.author || '(none)')}</div>` +
      `<div><b>标题:</b> ${escapeHtml(S.meta.title || '(none)')}</div>` +
      `<div><b>分辨率:</b> ${escapeHtml(S.meta.resolution || '(none)')}</div>` +
      `<div><b>originVideoKey:</b> ${escapeHtml(S.meta.originVideoKey || '(none)')}</div>` +
      `<div><b>候选URL:</b> ${escapeHtml(cand || '(none)')}</div>`;
  }

  function renderList() {
    if (!S.panelReady) return;
    const refs = document.getElementById(CFG.PANEL_ID)?.__refs;
    if (!refs) return;

    const arr = getFiltered();
    refs.mini.textContent = `${arr.length}/${S.list.length} 条`;
    refs.stats.textContent = `视频:${S.seqVideo - 1} ｜ 图片:${S.seqImg - 1} ｜ 显示:${arr.length}`;

    refs.list.innerHTML = '';
    arr.slice(0, 320).forEach(it => {
      const d = document.createElement('div');
      d.className = `item ${isVerifyLike(it.cleanUrl) ? 'verify' : ''}`;
      const urlText = isVerifyLike(it.cleanUrl) ? `${CFG.VERIFY_PREFIX} ${it.cleanUrl}` : it.cleanUrl;

      d.innerHTML = `
        <div class="tags">
          <span class="tag ${it.type}">${escapeHtml(it.type)}</span>
          <span class="tag">${escapeHtml(it.source)}</span>
          <span class="tag">${escapeHtml(it.resolution || (it.type === 'image' ? 'img' : ''))}</span>
          <span class="tag">${escapeHtml(it.host || '')}</span>
        </div>
        <div class="name">${escapeHtml(it.filename || inferFilename(it))}</div>
        <div class="url">${escapeHtml(urlText)}</div>
        <div class="ops">
          <button data-op="copy">复制</button>
          <button data-op="open">打开</button>
          <button data-op="line">当前行</button>
        </div>
      `;

      d.querySelector('[data-op="copy"]').addEventListener('click', () => copyText(it.cleanUrl));
      d.querySelector('[data-op="open"]').addEventListener('click', () => openUrl(it.cleanUrl));
      d.querySelector('[data-op="line"]').addEventListener('click', () => {
        copyText(`[${it.type}] [${it.source}] ${it.filename}\n${urlText}`);
      });

      refs.list.appendChild(d);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /********************
   * 扫描调度
   ********************/
  function fullRescan() {
    scanMetaBasics();
    scanResolutionHints();
    scanDomMedia();
    scanPerformance();
    setTimeout(scanNoteDetailMapAndScripts, 500);
    setTimeout(scanMetaBasics, 900);
    setTimeout(scanResolutionHints, 1300);
    setTimeout(scanNoteDetailMapAndScripts, 2500);
    setTimeout(scanNoteDetailMapAndScripts, 6000);
    renderMeta();
    renderList();
  }

  function observeDom() {
    try {
      const mo = new MutationObserver(() => {
        scanDomMedia();
        scanMetaBasics();
        scanResolutionHints();
      });
      mo.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset']
      });
    } catch {}
  }

  function watchRoute() {
    setInterval(() => {
      if (location.href !== S.routeKey) {
        S.routeKey = location.href;
        S.seqVideo = 1;
        S.seqImg = 1;
        S.meta = {
          noteId: '',
          author: '',
          title: '',
          resolution: '',
          originVideoKey: '',
          lastVideoUrl: '',
          pageType: '',
          xsecToken: ''
        };
        setTimeout(fullRescan, 500);
      } else {
        scanPerformance();
      }
    }, 2500);
  }

  /********************
   * 启动
   ********************/
  function init() {
    restore();
    parseNoteIdAndTokenFromUrl();

    const waitUI = setInterval(() => {
      if (document.documentElement && (document.body || document.readyState !== 'loading')) {
        clearInterval(waitUI);
        ensurePanel();
        renderMeta();
        renderList();
      }
    }, 180);

    fullRescan();
    observeDom();
    watchRoute();
  }

  init();
})();

/* ========= 模块B：XHS/B站/公众号嗅探版（非小红书站点运行，避免与模块A冲突） ========= */
(function () {
  'use strict';
  if (/xiaohongshu\.com/i.test(location.host)) return;

  const CFG = {
    VERIFY_PREFIX: '⚠VERIFY',
    MAX_ITEMS: 2200,
    PANEL_ID: '__xb_cc_panel__',
    STORAGE_KEY: '__xb_cc_store_v025a__',
    LONGPRESS_MS: 450,
    WX_LITE_MODE: true,
    HEAVY_HTML_SCAN_ON_WX: false,
    PERF_SCAN_INTERVAL_MS: 6000,
    MUTATION_DEBOUNCE_MS: 1200,
    WX_DIRECT_ONLY_MODE: true,
  };

  const S = {
    list: [],
    dedupe: new Set(),
    routeKey: location.href,
    panelReady: false,
    collapsed: false,
    filterText: '',
    filterType: 'all',
    siteOnly: 'all', // all / xiaohongshu / bilibili / weixin / other
    verifyOnly: false,
    seq: 1,
  };

  const SITE_RULES = [
    { name: 'xiaohongshu', re: /xiaohongshu\.com|xhscdn\.com/i },
    { name: 'bilibili', re: /bilibili\.com|bilivideo\.com|upos-/i },
    { name: 'weixin', re: /mp\.weixin\.qq\.com|res\.wx\.qq\.com|mpvideo\.qpic\.cn|mp\.video\.weixin\.qq\.com|v\.qq\.com/i },
  ];

  /********************
   * 工具函数
   ********************/
  function safeText(v) {
    return String(v ?? '').replace(/\s+/g, ' ').trim();
  }

  function now() {
    return Date.now();
  }

  function cleanUrl(raw = '') {
    try {
      const normalized = normalizeCapturedUrl(raw);
      const u = new URL(normalized, location.href);
      const noisy = ['utm_source', 'utm_medium', 'utm_campaign', 'spm', 'from', '_t', '_r'];
      noisy.forEach(k => u.searchParams.delete(k));

      if (/res\.wx\.qq\.com\/voice\/getvoice/i.test(u.href)) {
        const mid = u.searchParams.get('mediaid') || '';
        if (!mid || containsTemplatePlaceholder(mid)) return '';
      }
      return u.toString();
    } catch {
      return '';
    }
  }

  function hostOf(url = '') {
    try { return new URL(url, location.href).host; } catch { return ''; }
  }

  function extOf(url = '') {
    try {
      const p = new URL(url, location.href).pathname.toLowerCase();
      const m = p.match(/\.([a-z0-9]{2,6})$/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function isHttp(url = '') {
    return /^https?:\/\//i.test(url);
  }

  function decodeEscaped(s) {
    if (!s) return s;
    try { return JSON.parse(`"${s}"`); } catch { return s; }
  }

  function detectSite(url = '') {
    const s = `${location.host} ${url}`;
    const hit = SITE_RULES.find(r => r.re.test(s));
    return hit ? hit.name : 'other';
  }

  function isWxPage() { return /(?:^|\.)mp\.weixin\.qq\.com$/i.test(location.host); }
  function isBiliPage() { return /(?:^|\.)bilibili\.com$/i.test(location.host); }
  function isXhsPage() { return /xiaohongshu\.com/i.test(location.host); }

  function htmlUnescape(s = '') {
    return String(s).replace(/&amp;/gi, '&').replace(/&#x26;/gi, '&').replace(/&#38;/gi, '&');
  }

  function containsTemplatePlaceholder(s = '') {
    const t = String(s || '');
    return (
      /\$\{[^}]+\}/.test(t) ||
      /encodeURIComponent\s*\(/i.test(t) ||
      /%24%7B/i.test(t) ||
      /encodeURIComponent%28/i.test(t) ||
      /%7D%60%2C/i.test(t)
    );
  }

  function isWxAdTrackUrl(s = '') {
    return /https?:\/\/ad\.wx\.com(?::\d+)?\/cgi-bin\/(?:exposure|click)\b/i.test(String(s || ''));
  }

  function isWxDirectPlayableUrl(url = '', typeHint = '') {
    try {
      const raw = normalizeCapturedUrl(url);
      if (!raw || containsTemplatePlaceholder(raw) || isWxAdTrackUrl(raw)) return false;
      const u = new URL(raw, location.href);
      const host = (u.host || '').toLowerCase();
      const path = (u.pathname || '').toLowerCase();
      const href = u.toString().toLowerCase();
      const type = String(typeHint || '').toLowerCase();

      // 公众号音频：只保留真实 getvoice?mediaid=xxx
      if (/^res\.wx\.qq\.com$/.test(host) && /\/voice\/getvoice$/.test(path)) {
        const mid = u.searchParams.get('mediaid') || '';
        return !!mid && !containsTemplatePlaceholder(mid) && /^[A-Za-z0-9+\/_=-]{8,}$/.test(mid);
      }

      // 公众号视频直链/切片/清晰度资源（只保留 CDN/视频资源）
      if (/mpvideo\.qpic\.cn$/.test(host) || /(?:^|\.)mp\.video\.weixin\.qq\.com$/.test(host)) {
        return /\.(mp4|m3u8|mpd|ts|m4s)(\?|#|$)/.test(href) || /videoplay|play|stream|playlist|getvideo/.test(href);
      }

      // 某些腾讯视频直链（仅实际媒体）
      if (/(^|\.)qq\.com$/.test(host) || /(^|\.)gtimg\.com$/.test(host) || /qpic\.cn$/.test(host)) {
        if (type === 'audio' || type === 'video' || /\.(mp4|m3u8|mpd|ts|m4s|mp3|m4a|aac)(\?|#|$)/.test(href)) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  function normalizeCapturedUrl(raw = '') {
    let u = decodeEscaped(String(raw || ''));
    u = htmlUnescape(u);
    u = u.replace(/&amp%3B/gi, '&');
    u = u.replace(/amp%3B/gi, '');
    u = u.replace(/\s+/g, '');
    // 常见站点 http 降级链接升级为 https（避免 iOS/Safari 打不开）
    u = u.replace(/^http:\/\/(res\.wx\.qq\.com|mpvideo\.qpic\.cn|mp\.video\.weixin\.qq\.com|sns-(?:video|img)-(?:qc|bh|db|hw)\.xhscdn\.com)/i, 'https://$1');
    return u;
  }


  function guessType(url = '', ct = '') {
    const s = `${url} ${ct}`.toLowerCase();
    if (/m3u8|application\/vnd\.apple\.mpegurl|application\/x-mpegurl/.test(s)) return 'm3u8';
    if (/mpd|application\/dash\+xml/.test(s)) return 'mpd';

    if (/res\.wx\.qq\.com\/voice\/getvoice\?mediaid=/.test(s)) return 'audio';

    if (/videoplayback|video|mp4|webm|mov|m4v|flv|m4s|mp2t/.test(s)) return 'video';
    if (/audio|mp3|m4a|aac|flac|wav|ogg/.test(s)) return 'audio';
    if (/image|jpg|jpeg|png|webp|gif|avif|qpic/.test(s)) return 'image';
    return 'other';
  }

  function shouldCatch(url = '', ct = '') {
    const s = `${url} ${ct}`.toLowerCase();
    return (
      /\.(mp4|m4v|mov|webm|mkv|flv|m4s|ts|mp3|m4a|aac|flac|wav|ogg|m3u8|mpd|jpg|jpeg|png|webp|gif|avif)(\?|#|$)/.test(s) ||
      /m3u8|mpd|videoplayback|playurl|media|stream|playlist|image|video|audio|xhscdn|bilivideo|upos-|res\.wx\.qq\.com\/voice\/getvoice|voice\/getvoice\?mediaid=|mpvideo|mp\.video\.weixin\.qq\.com|qpic/.test(s)
    );
  }

  function isVerifyLike(url = '') {
    return /verify|captcha|challenge|download_token|encfilekey|sign=|token=|auth|expires=|x-amz/i.test(url);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fileNameOf(item) {
    if (/res\.wx\.qq\.com\/voice\/getvoice\?mediaid=/i.test(item.cleanUrl || '')) {
      try {
        const u = new URL(item.cleanUrl);
        const mid = u.searchParams.get('mediaid') || 'wxvoice';
        return `weixin_voice_${mid}.mp3`;
      } catch {
        return 'weixin_voice.mp3';
      }
    }

    try {
      const u = new URL(item.cleanUrl || item.url, location.href);
      const p = decodeURIComponent((u.pathname || '').split('/').pop() || '');
      if (p) return p.slice(0, 180);
    } catch {}

    const t = safeText(item.title || '');
    return t || `media_${item.id || now()}`;
  }

  function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function openUrl(url) {
    try { window.open(url, '_blank'); } catch { location.href = url; }
  }

  function persist() {
    try {
      sessionStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(S.list.slice(0, 900)));
    } catch {}
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(CFG.STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        const key = `${it.source}|${it.type}|${it.cleanUrl}`;
        S.dedupe.add(key);
      }
      S.list = arr;
      S.seq = (arr.length || 0) + 1;
    } catch {}
  }

  function uniq(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  /********************
   * 核心：收集条目
   ********************/
  function addItem(raw) {
    try {
      const url = raw.url || '';
      if (!url) return;
      const clean = cleanUrl(url);
      if (!clean || !isHttp(clean)) return;
      if (containsTemplatePlaceholder(clean)) return;
      if (isWxPage() && isWxAdTrackUrl(clean)) return;

      const type = raw.type || guessType(clean, raw.contentType || '');

      // v0.2.6：公众号“仅保留可直开音视频链接”模式
      if (isWxPage() && CFG.WX_DIRECT_ONLY_MODE) {
        if (type === 'audio' || type === 'video' || type === 'm3u8' || type === 'mpd') {
          if (!isWxDirectPlayableUrl(clean, type)) return;
        } else if (/weixin/i.test(raw.site || '') || /weixin/i.test(raw.source || '') || /wx_/i.test(raw.source || '')) {
          // 公众号来源的非音视频条目直接丢弃（减少噪音和卡顿）
          return;
        }
      }
      const source = raw.source || 'unknown';
      const site = raw.site || detectSite(clean);

      const key = `${source}|${type}|${clean}`;
      if (S.dedupe.has(key)) return;
      S.dedupe.add(key);

      const item = {
        id: `${now()}_${S.seq++}`,
        ts: now(),
        url,
        cleanUrl: clean,
        type,
        source,
        site,
        ext: extOf(clean),
        contentType: raw.contentType || '',
        method: raw.method || 'GET',
        title: safeText(document.title),
        pageUrl: location.href,
        referer: location.href,
      };

      S.list.unshift(item);
      if (S.list.length > CFG.MAX_ITEMS) S.list.length = CFG.MAX_ITEMS;

      persist();
      renderList();
    } catch {}
  }

  /********************
   * Hook: fetch / XHR
   ********************/
  (function hookFetch() {
    const _fetch = window.fetch;
    if (!_fetch) return;

    window.fetch = async function (...args) {
      let reqUrl = '';
      let method = 'GET';
      try {
        const req = args[0];
        if (typeof req === 'string') reqUrl = req;
        else if (req && req.url) {
          reqUrl = req.url;
          method = req.method || 'GET';
        }
      } catch {}

      if (reqUrl) addItem({ url: reqUrl, method, source: 'fetch_req' });

      const res = await _fetch.apply(this, args);

      try {
        const resUrl = res?.url || reqUrl;
        const ct = res?.headers?.get?.('content-type') || '';
        if (shouldCatch(resUrl, ct)) {
          addItem({ url: resUrl, method, contentType: ct, source: 'fetch_res' });
        }

        // 公众号/站点 JSON 注水兜底（轻量）
        if (/json/i.test(ct)) {
          res.clone().text().then(txt => {
            if (!txt) return;
            const urls = txt.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
            urls.slice(0, 80).forEach(u => {
              if (shouldCatch(u)) addItem({ url: decodeEscaped(u), source: 'fetch_json_url' });
            });
          }).catch(() => {});
        }
      } catch {}

      return res;
    };
  })();

  (function hookXHR() {
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__xb_method = method || 'GET';
      this.__xb_url = url || '';
      return rawOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      try {
        if (this.__xb_url) addItem({ url: this.__xb_url, method: this.__xb_method, source: 'xhr_req' });

        this.addEventListener('load', () => {
          try {
            const u = this.responseURL || this.__xb_url || '';
            const ct = this.getResponseHeader?.('content-type') || '';
            if (shouldCatch(u, ct)) {
              addItem({ url: u, method: this.__xb_method, contentType: ct, source: 'xhr_res' });
            }

            if (/json/i.test(ct) && typeof this.responseText === 'string') {
              const urls = this.responseText.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
              urls.slice(0, 80).forEach(x => {
                if (shouldCatch(x)) addItem({ url: decodeEscaped(x), source: 'xhr_json_url' });
              });
            }
          } catch {}
        });
      } catch {}
      return rawSend.apply(this, args);
    };
  })();

  /********************
   * 扫描：DOM / performance / HTML
   ********************/
  function scanDomMedia() {
    try {
      document.querySelectorAll('video,audio').forEach(el => {
        const u = el.currentSrc || el.src;
        if (u) addItem({ url: u, source: 'media_tag' });
      });

      document.querySelectorAll('source[src]').forEach(el => {
        const u = el.getAttribute('src');
        if (u) addItem({ url: u, source: 'source_tag' });
      });

      document.querySelectorAll('img[src],img[srcset]').forEach(el => {
        const u = el.currentSrc || el.getAttribute('src');
        if (u) addItem({ url: u, source: 'img_tag' });
      });

      document.querySelectorAll('a[href]').forEach(a => {
        const u = a.href || '';
        if (u && shouldCatch(u)) addItem({ url: u, source: 'a_tag' });
      });
    } catch {}
  }

  function scanPerformance() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const e of entries) {
        const u = e.name || '';
        if (u && shouldCatch(u)) addItem({ url: u, source: 'performance' });
      }
    } catch {}
  }

  function scanHtmlLite() {
    try {
      if (isWxPage() && CFG.WX_LITE_MODE && !CFG.HEAVY_HTML_SCAN_ON_WX) {
        scanMpWeixinSpecial();
        return;
      }

      const html = document.documentElement?.innerHTML || '';

      const re = /(https?:\/\/[^\s"'<>\\]+(?:m3u8|mpd|mp4|webm|m4s|ts|mp3|m4a|jpg|jpeg|png|webp|gif|avif|json)[^\s"'<>\\]*)/gi;
      let m, n = 0;
      while ((m = re.exec(html)) && n < 220) {
        const u = normalizeCapturedUrl(m[1]);
        if (!u || containsTemplatePlaceholder(u) || isWxAdTrackUrl(u)) { n++; continue; }
        addItem({ url: u, source: 'html_scan' });
        n++;
      }

      const wxVoice = html.match(/https?:\/\/res\.wx\.qq\.com\/voice\/getvoice\?mediaid=[^\s"'<>\\]+/g) || [];
      wxVoice.slice(0, 100).forEach(u => {
        const x = normalizeCapturedUrl(u);
        if (!containsTemplatePlaceholder(x)) addItem({ url: x, source: 'html_scan_wxvoice', site: 'weixin', type: 'audio' });
      });

      const apiLike = html.match(/https?:\/\/[^\s"'<>\\]+(?:getvoice|getvideo|videoplayback|playurl|stream)[^\s"'<>\\]*/g) || [];
      apiLike.slice(0, 100).forEach(u => {
        const x = normalizeCapturedUrl(u);
        if (!containsTemplatePlaceholder(x) && !isWxAdTrackUrl(x)) addItem({ url: x, source: 'html_api_like' });
      });
    } catch {}
  }

  /********************
   * 小红书专用增强
   ********************/
  function scanXhsSpecial() {
    if (!/xiaohongshu\.com/i.test(location.host)) return;

    try {
      const html = document.documentElement?.innerHTML || '';

      const xhsCdn = html.match(/https?:\/\/sns-(?:video|img)-(?:hw|bh|qc|db)\.xhscdn\.com\/[^\s"'<>\\]+/g) || [];
      xhsCdn.slice(0, 180).forEach(u => addItem({ url: normalizeCapturedUrl(u), source: 'xhs_cdn' }));

      const keyMatches = [];
      const keyRegexes = [
        /"originVideoKey"\s*:\s*"([^"]+)"/g,
        /originVideoKey["']?\s*:\s*["']([^"']+)["']/g,
        /"masterUrl"\s*:\s*"([^"]+)"/g
      ];
      for (const re of keyRegexes) {
        let m;
        while ((m = re.exec(html))) if (m[1]) keyMatches.push(m[1]);
      }

      for (const k of keyMatches.slice(0, 80)) {
        let key = k;
        try { key = JSON.parse(`"${k}"`); } catch {}
        if (/^https?:\/\//i.test(key)) {
          addItem({ url: key, source: 'xhs_originKey_url' });
        } else if (/^[a-zA-Z0-9/_\-\.]+$/.test(key)) {
          addItem({ url: `https://sns-video-hw.xhscdn.com/${key}`, source: 'xhs_originKey_join' });
        }
      }

      const imgKeyRegexes = [
        /"urlDefault"\s*:\s*"([^"]+)"/g,
        /"urlPre"\s*:\s*"([^"]+)"/g
      ];
      for (const re of imgKeyRegexes) {
        let m, c = 0;
        while ((m = re.exec(html)) && c < 120) {
          if (/^https?:\/\//i.test(m[1])) addItem({ url: normalizeCapturedUrl(m[1]), source: 'xhs_img_field' });
          c++;
        }
      }

      const og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) addItem({ url: og, source: 'xhs_og_image' });
    } catch {}
  }

  /********************
   * B站专用增强
   ********************/
  function scanBiliSpecial() {
    if (!/bilibili\.com/i.test(location.host)) return;

    try {
      const html = document.documentElement?.innerHTML || '';

      const biliCdn = html.match(/https?:\/\/[^\s"'<>\\]*(?:bilivideo\.com|upos-[^\/]+\.bilivideo\.com)\/[^\s"'<>\\]+/g) || [];
      biliCdn.slice(0, 260).forEach(u => addItem({ url: normalizeCapturedUrl(u), source: 'bili_cdn' }));

      let m;
      const baseRegs = [
        /"baseUrl"\s*:\s*"([^"]+)"/g,
        /"base_url"\s*:\s*"([^"]+)"/g
      ];
      baseRegs.forEach((re, idx) => {
        while ((m = re.exec(html))) addItem({ url: decodeEscaped(m[1]), source: idx ? 'bili_base_url' : 'bili_baseUrl' });
      });

      const backupRegs = [
        /"backupUrl"\s*:\s*\[([^\]]+)\]/g,
        /"backup_url"\s*:\s*\[([^\]]+)\]/g
      ];
      backupRegs.forEach(re => {
        while ((m = re.exec(html))) {
          const arrStr = m[1];
          const urlRe = /"([^"]+)"/g;
          let u;
          while ((u = urlRe.exec(arrStr))) addItem({ url: decodeEscaped(u[1]), source: 'bili_backup' });
        }
      });

      const subLike = html.match(/https?:\/\/[^\s"'<>\\]+(?:subtitle|danmaku|dm)\b[^\s"'<>\\]*/g) || [];
      subLike.slice(0, 80).forEach(u => addItem({ url: normalizeCapturedUrl(u), source: 'bili_sub_dm' }));

      document.querySelectorAll('script').forEach(sc => {
        const txt = sc.textContent || '';
        if (!txt) return;
        if (txt.includes('__playinfo__') || txt.includes('dash') || txt.includes('durl')) {
          const urls = txt.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
          urls.slice(0, 180).forEach(u => {
            if (/bilivideo|bilibili|upos-|m4s|mp4|m3u8|json/i.test(u)) addItem({ url: normalizeCapturedUrl(u), source: 'bili_script' });
          });
        }
      });
    } catch {}
  }

  /********************
   * 公众号专用增强（mp.weixin.qq.com）
   ********************/
  function scanMpWeixinSpecial() {
    if (!/mp\.weixin\.qq\.com/i.test(location.host)) return;

    try {
      const html = document.documentElement?.innerHTML || '';
      if (!html) return;

      // A) 直接 getvoice
      const directVoice = html.match(/https?:\/\/res\.wx\.qq\.com\/voice\/getvoice\?mediaid=[^\s"'<>\\]+/g) || [];
      directVoice.slice(0, 120).forEach(u => {
        const x = normalizeCapturedUrl(u);
        if (!containsTemplatePlaceholder(x)) addItem({ url: x, source: 'wx_voice_direct', site: 'weixin', type: 'audio' });
      });

      // B) voice_id / mediaid / music_id
      const ids = new Set();
      const idRegs = [
        /"voice_id"\s*:\s*"([^"]+)"/g,
        /voice_id["']?\s*:\s*["']([^"']+)["']/g,
        /"mediaid"\s*:\s*"([^"]+)"/g,
        /mediaid["']?\s*:\s*["']([^"']+)["']/g,
        /"music_id"\s*:\s*"([^"]+)"/g
      ];
      for (const re of idRegs) {
        let m, c = 0;
        while ((m = re.exec(html)) && c < 160) {
          let id = decodeEscaped(m[1]);
          if (id && /^[A-Za-z0-9+/=_-]{8,}$/.test(id)) ids.add(id);
          c++;
        }
      }

      // C) mp/audio?voice_id=...
      const mpAudioLinks = html.match(/https?:\/\/mp\.weixin\.qq\.com\/mp\/audio\?[^\s"'<>]+/g) || [];
      mpAudioLinks.slice(0, 120).forEach(link => {
        try {
          const u = new URL(link);
          const vid = u.searchParams.get('voice_id') || u.searchParams.get('mediaid');
          if (vid) ids.add(vid);
          // 仅提取 voice_id/mediaid 用于拼接真实 getvoice 直链，不保留 mp.weixin 中转链接
          if (!CFG.WX_DIRECT_ONLY_MODE) addItem({ url: link, source: 'wx_mp_audio', site: 'weixin', type: 'audio' });
        } catch {}
      });

      // D) 拼接真实语音
      for (const id of ids) {
        addItem({
          url: `https://res.wx.qq.com/voice/getvoice?mediaid=${encodeURIComponent(id)}`,
          source: 'wx_voice_join',
          site: 'weixin',
          type: 'audio'
        });
      }

      // E) 公众号视频增强：抓常见 video_url / mp4_url / url_info.url
      const videoFieldRegs = [
        /"video_url"\s*:\s*"([^"]+)"/g,
        /"mp4_url"\s*:\s*"([^"]+)"/g,
        /"url"\s*:\s*"(https?:\/\/[^"]*(?:mpvideo|qpic|qq\.com|video)[^"]*)"/g
      ];
      for (const re of videoFieldRegs) {
        let m, c = 0;
        while ((m = re.exec(html)) && c < 160) {
          const u = normalizeCapturedUrl(m[1]);
          if (!isWxAdTrackUrl(u) && (shouldCatch(u) || /mpvideo|weixin|qpic|qq\.com/i.test(u))) {
            addItem({ url: u, source: 'wx_video_field', site: 'weixin' });
          }
          c++;
        }
      }

      // F) scripts 内提取（微信文章常把视频配置塞到 JS）
      document.querySelectorAll('script').forEach((sc, idx) => {
        const txt = sc.textContent || '';
        if (!txt) return;
        if (!/voice_id|mediaid|mpvideo|video_url|mp4_url|v\.qq\.com|qpic/i.test(txt)) return;

        const urls = txt.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
        urls.slice(0, 150).forEach(u => {
          if (shouldCatch(u) || /mpvideo|weixin|qpic|v\.qq\.com|qq\.com/i.test(u)) {
            addItem({ url: decodeEscaped(u), source: `wx_script_${idx}`, site: 'weixin' });
          }
        });

        // 继续抓脚本里的 voice_id
        const reVoice = /(?:voice_id|mediaid)["']?\s*[:=]\s*["']([^"']+)["']/g;
        let m, c = 0;
        while ((m = reVoice.exec(txt)) && c < 60) {
          const id = decodeEscaped(m[1]);
          if (id && /^[A-Za-z0-9+/=_-]{8,}$/.test(id)) {
            addItem({
              url: `https://res.wx.qq.com/voice/getvoice?mediaid=${encodeURIComponent(id)}`,
              source: `wx_script_join_${idx}`,
              site: 'weixin',
              type: 'audio'
            });
          }
          c++;
        }
      });

      // G) 兜底抓 res.wx.qq.com / qpic / mpvideo
      const wxRes = html.match(/https?:\/\/(?:res\.wx\.qq\.com|mpvideo\.qpic\.cn|mp\.video\.weixin\.qq\.com|[^\/]+qpic\.cn)\/[^\s"'<>\\]+/g) || [];
      wxRes.slice(0, 180).forEach(u => {
        const x = normalizeCapturedUrl(u);
        if (!containsTemplatePlaceholder(x) && !isWxAdTrackUrl(x)) addItem({ url: x, source: 'wx_res_scan', site: 'weixin' });
      });

    } catch {}
  }

  /********************
   * UI
   ********************/
  function ensurePanel() {
    if (document.getElementById(CFG.PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = CFG.PANEL_ID;
    panel.innerHTML = `
      <style>
        #${CFG.PANEL_ID}{
          position:fixed; z-index:2147483647; right:8px; bottom:8px; width:366px; max-width:calc(100vw - 16px);
          background:rgba(18,18,20,.96); color:#f2f2f3; border:1px solid #333; border-radius:12px;
          box-shadow:0 8px 28px rgba(0,0,0,.35); font:12px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        }
        #${CFG.PANEL_ID}.collapsed .xb-body{ display:none; }
        #${CFG.PANEL_ID} .xb-head{
          padding:8px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px;
          border-bottom:1px solid #2f2f33; user-select:none; -webkit-user-select:none;
        }
        #${CFG.PANEL_ID} .xb-title{ font-weight:700; font-size:13px; }
        #${CFG.PANEL_ID} .xb-mini{ color:#bdbdc6; font-size:11px; }
        #${CFG.PANEL_ID} button, #${CFG.PANEL_ID} select, #${CFG.PANEL_ID} input{
          border:1px solid #3a3a40; background:#26262b; color:#f2f2f3; border-radius:8px;
          font-size:11px; padding:6px 8px;
        }
        #${CFG.PANEL_ID} .xb-head button{ padding:5px 8px; }
        #${CFG.PANEL_ID} .xb-body{ padding:8px; }
        #${CFG.PANEL_ID} .row{ display:flex; gap:6px; margin-bottom:6px; }
        #${CFG.PANEL_ID} .row > *{ flex:1; min-width:0; }
        #${CFG.PANEL_ID} .row .fit{ flex:0 0 auto; }
        #${CFG.PANEL_ID} .stats{ color:#bdbdc6; margin:2px 0 6px; font-size:10px; }
        #${CFG.PANEL_ID} .list{ max-height:46vh; overflow:auto; display:flex; flex-direction:column; gap:6px; }
        #${CFG.PANEL_ID} .item{ border:1px solid #303036; border-radius:10px; background:#1e1e22; padding:7px; }
        #${CFG.PANEL_ID} .item.verify{ border-color:#6b3434; }
        #${CFG.PANEL_ID} .tags{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
        #${CFG.PANEL_ID} .tag{ border:1px solid #3b3b42; color:#bdbdc6; border-radius:999px; padding:1px 6px; font-size:10px; background:#26262c; }
        #${CFG.PANEL_ID} .name{ font-size:11px; color:#f2f2f3; word-break:break-all; margin-bottom:4px; }
        #${CFG.PANEL_ID} .url{ font-size:10px; color:#bdbdc6; word-break:break-all; max-height:3.9em; overflow:hidden; }
        #${CFG.PANEL_ID} .ops{ display:flex; gap:5px; margin-top:6px; }
        #${CFG.PANEL_ID} .ops button{ flex:1; padding:5px 6px; }
        #${CFG.PANEL_ID} .xhs{ color:#ffd7a3; }
        #${CFG.PANEL_ID} .bili{ color:#b7e0ff; }
        #${CFG.PANEL_ID} .wx{ color:#c8f7b8; }
      </style>
      <div class="xb-head">
        <div>
          <div class="xb-title">XHS/B站/公众号 嗅探 v0.2.5a</div>
          <div class="xb-mini" id="xbMini">0 条</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="xbToggle">收起</button>
          <button id="xbClose">×</button>
        </div>
      </div>
      <div class="xb-body">
        <div class="row">
          <input id="xbFilter" placeholder="过滤：mp4 / m3u8 / mediaid / 域名 / 标题" />
          <select id="xbType" class="fit">
            <option value="all">全部</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="image">图片</option>
            <option value="m3u8">m3u8</option>
            <option value="mpd">mpd</option>
          </select>
        </div>

        <div class="row">
          <select id="xbSite" class="fit">
            <option value="all">全部站点</option>
            <option value="xiaohongshu">小红书</option>
            <option value="bilibili">B站</option>
            <option value="weixin">公众号</option>
            <option value="other">其他</option>
          </select>
          <button id="xbCurSite" class="fit">当前站点</button>
          <button id="xbVerifyOnly" class="fit">仅VERIFY:关</button>
        </div>

        <div class="row">
          <button id="xbManifest" class="fit">m3u8/mpd</button>
          <button id="xbCopyAll">复制全部URL</button>
          <button id="xbExport">导出文本</button>
          <button id="xbClear">清空</button>
        </div>

        <div class="row">
          <button id="xbExportGrouped">按域名分组</button>
          <button id="xbAria2">aria2</button>
          <button id="xbYtdlp">yt-dlp</button>
          <button id="xbFFmpeg">ffmpeg</button>
        </div>

        <div class="stats" id="xbStats">0 条</div>
        <div class="list" id="xbList"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    const $ = (sel) => panel.querySelector(sel);
    const refs = {
      panel,
      mini: $('#xbMini'),
      toggle: $('#xbToggle'),
      close: $('#xbClose'),
      filter: $('#xbFilter'),
      type: $('#xbType'),
      site: $('#xbSite'),
      curSite: $('#xbCurSite'),
      verifyOnly: $('#xbVerifyOnly'),
      manifest: $('#xbManifest'),
      copyAll: $('#xbCopyAll'),
      export: $('#xbExport'),
      clear: $('#xbClear'),
      exportGrouped: $('#xbExportGrouped'),
      aria2: $('#xbAria2'),
      ytdlp: $('#xbYtdlp'),
      ffmpeg: $('#xbFFmpeg'),
      stats: $('#xbStats'),
      list: $('#xbList'),
    };
    panel.__refs = refs;

    refs.toggle.addEventListener('click', () => {
      S.collapsed = !S.collapsed;
      panel.classList.toggle('collapsed', S.collapsed);
      refs.toggle.textContent = S.collapsed ? '展开' : '收起';
    });
    refs.close.addEventListener('click', () => panel.remove());

    refs.filter.addEventListener('input', () => {
      S.filterText = refs.filter.value.trim().toLowerCase();
      renderList();
    });

    refs.type.addEventListener('change', () => {
      S.filterType = refs.type.value;
      renderList();
    });

    refs.site.addEventListener('change', () => {
      S.siteOnly = refs.site.value;
      renderList();
    });

    refs.curSite.addEventListener('click', () => {
      const s = detectSite(location.href);
      refs.site.value = s;
      S.siteOnly = s;
      renderList();
    });

    refs.verifyOnly.addEventListener('click', () => {
      S.verifyOnly = !S.verifyOnly;
      refs.verifyOnly.textContent = `仅VERIFY:${S.verifyOnly ? '开' : '关'}`;
      renderList();
    });

    refs.manifest.addEventListener('click', () => {
      refs.type.value = 'all';
      refs.filter.value = 'm3u8';
      S.filterType = 'all';
      S.filterText = 'm3u8';
      renderList();
    });

    refs.copyAll.addEventListener('click', () => {
      copyText(getFiltered().map(x => x.cleanUrl).join('\n'));
    });

    refs.export.addEventListener('click', () => {
      const text = getFiltered().map((x, i) => {
        const u = x.cleanUrl;
        const p = isVerifyLike(u) ? `${CFG.VERIFY_PREFIX} ` : '';
        return `${i + 1}. [${x.site}] [${x.type}] [${x.source}] ${fileNameOf(x)}\n${p}${u}`;
      }).join('\n\n');
      copyText(text);
    });

    refs.exportGrouped.addEventListener('click', () => {
      const arr = getFiltered();
      const map = new Map();

      for (const x of arr) {
        const h = hostOf(x.cleanUrl) || 'unknown-host';
        if (!map.has(h)) map.set(h, []);
        map.get(h).push(x);
      }

      const hosts = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
      const chunks = [];

      hosts.forEach(h => {
        chunks.push(`### ${h} (${map.get(h).length})`);
        map.get(h).forEach((x, i) => {
          const u = isVerifyLike(x.cleanUrl) ? `${CFG.VERIFY_PREFIX} ${x.cleanUrl}` : x.cleanUrl;
          chunks.push(`${i + 1}. [${x.site}] [${x.type}] [${x.source}] ${fileNameOf(x)}`);
          chunks.push(u);
        });
        chunks.push('');
      });

      copyText(chunks.join('\n'));
    });

    refs.clear.addEventListener('click', () => {
      S.list = [];
      S.dedupe.clear();
      persist();
      renderList();
    });

    refs.aria2.addEventListener('click', () => {
      const arr = getFiltered();
      const lines = [];
      for (const x of arr) {
        const out = fileNameOf(x).replace(/[\\/:*?"<>|]/g, '_').slice(0, 140);
        lines.push(`${x.cleanUrl}\n  out=${out}\n  header=Referer: ${x.pageUrl || x.referer || location.href}`);
      }
      copyText(lines.join('\n'));
    });

    refs.ytdlp.addEventListener('click', () => {
      const arr = getFiltered().filter(x => ['video', 'audio', 'm3u8', 'mpd'].includes(x.type));
      const lines = arr.map(x =>
        `yt-dlp --add-header "Referer: ${x.pageUrl || x.referer || location.href}" "${x.cleanUrl}"`
      );
      copyText(lines.join('\n'));
    });

    refs.ffmpeg.addEventListener('click', () => {
      const arr = getFiltered().filter(x => ['m3u8', 'mpd'].includes(x.type));
      const lines = arr.map((x, i) => {
        const base = fileNameOf(x).replace(/[\\/:*?"<>|]/g, '_').replace(/\.(m3u8|mpd)$/i, '') || `out_${i + 1}`;
        return `ffmpeg -headers "Referer: ${x.pageUrl || x.referer || location.href}\\r\\n" -i "${x.cleanUrl}" -c copy "${base}.mp4"`;
      });
      copyText(lines.join('\n'));
    });

    let pressTimer = null;
    const head = panel.querySelector('.xb-head');
    head.addEventListener('touchstart', () => {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => refs.toggle.click(), CFG.LONGPRESS_MS);
    }, { passive: true });
    head.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
    head.addEventListener('touchcancel', () => clearTimeout(pressTimer), { passive: true });

    S.panelReady = true;
    renderList();
  }

  function getFiltered() {
    let arr = S.list.slice();

    if (S.filterType !== 'all') arr = arr.filter(x => x.type === S.filterType);
    if (S.siteOnly !== 'all') arr = arr.filter(x => x.site === S.siteOnly);
    if (S.verifyOnly) arr = arr.filter(x => isVerifyLike(x.cleanUrl));

    if (S.filterText) {
      const kw = S.filterText;
      arr = arr.filter(x =>
        (x.cleanUrl || '').toLowerCase().includes(kw) ||
        (x.title || '').toLowerCase().includes(kw) ||
        (x.source || '').toLowerCase().includes(kw) ||
        (x.site || '').toLowerCase().includes(kw)
      );
    }

    arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return arr;
  }

  function renderList() {
    if (!S.panelReady) return;
    const panel = document.getElementById(CFG.PANEL_ID);
    if (!panel || !panel.__refs) return;
    const refs = panel.__refs;

    const arr = getFiltered();
    refs.mini.textContent = `${arr.length}/${S.list.length} 条`;
    refs.stats.textContent =
      `当前页：${safeText(document.title).slice(0, 26)} ｜ 站点:${detectSite(location.href)} ｜ 总 ${S.list.length} ｜ 显示 ${arr.length}`;

    refs.list.innerHTML = '';

    for (const it of arr.slice(0, 320)) {
      const div = document.createElement('div');
      div.className = `item ${isVerifyLike(it.cleanUrl) ? 'verify' : ''}`;

      let tagSiteCls = '';
      if (it.site === 'xiaohongshu') tagSiteCls = 'xhs';
      else if (it.site === 'bilibili') tagSiteCls = 'bili';
      else if (it.site === 'weixin') tagSiteCls = 'wx';

      const urlText = isVerifyLike(it.cleanUrl) ? `${CFG.VERIFY_PREFIX} ${it.cleanUrl}` : it.cleanUrl;

      div.innerHTML = `
        <div class="tags">
          <span class="tag ${tagSiteCls}">${escapeHtml(it.site)}</span>
          <span class="tag">${escapeHtml(it.type)}</span>
          <span class="tag">${escapeHtml(it.source)}</span>
          <span class="tag">${escapeHtml(hostOf(it.cleanUrl))}</span>
        </div>
        <div class="name">${escapeHtml(fileNameOf(it))}</div>
        <div class="url">${escapeHtml(urlText)}</div>
        <div class="ops">
          <button data-op="copy">复制</button>
          <button data-op="open">打开</button>
          <button data-op="line">当前行</button>
        </div>
      `;

      div.querySelector('[data-op="copy"]').addEventListener('click', () => copyText(it.cleanUrl));
      div.querySelector('[data-op="open"]').addEventListener('click', () => openUrl(it.cleanUrl));
      div.querySelector('[data-op="line"]').addEventListener('click', () => {
        const line = `[${it.site}] [${it.type}] [${it.source}] ${fileNameOf(it)}\n${urlText}`;
        copyText(line);
      });

      refs.list.appendChild(div);
    }
  }

  /********************
   * 启动流程
   ********************/
  function bootScans() {
    if (isWxPage()) {
      scanMpWeixinSpecial();
      setTimeout(scanPerformance, 1200);
      if (!CFG.WX_LITE_MODE) {
        setTimeout(scanHtmlLite, 1700);
        setTimeout(scanDomMedia, 2200);
      }
      return;
    }

    scanDomMedia();
    scanPerformance();
    setTimeout(scanDomMedia, 700);
    setTimeout(scanPerformance, 1200);
    setTimeout(scanHtmlLite, 1700);
    setTimeout(scanXhsSpecial, 2200);
    setTimeout(scanBiliSpecial, 2400);
    setTimeout(scanMpWeixinSpecial, 2600);
  }
  function observeDom() {
    try {
      let timer = null;
      const mo = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (isWxPage() && CFG.WX_LITE_MODE) scanMpWeixinSpecial();
          else scanDomMedia();
        }, CFG.MUTATION_DEBOUNCE_MS || 1200);
      });
      mo.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: !(isWxPage() && CFG.WX_LITE_MODE),
        attributeFilter: ['src', 'srcset', 'href']
      });
    } catch {}
  }
  function watchRoute() {
    setInterval(() => {
      if (location.href !== S.routeKey) {
        S.routeKey = location.href;
        setTimeout(bootScans, 500);
      } else {
        if (!(isWxPage() && CFG.WX_LITE_MODE)) scanPerformance();
      }
    }, CFG.PERF_SCAN_INTERVAL_MS || 6000);
  }
  function init() {
    restore();

    const waitUI = setInterval(() => {
      if (document.documentElement && (document.body || document.readyState !== 'loading')) {
        clearInterval(waitUI);
        ensurePanel();
        renderList();
      }
    }, 180);

    bootScans();
    observeDom();
    watchRoute();

    if (!isWxPage() || !CFG.WX_LITE_MODE) {
      setTimeout(bootScans, 4000);
      setTimeout(bootScans, 8000);
    } else {
      setTimeout(scanMpWeixinSpecial, 2500);
    }
  }

  init();
})();
