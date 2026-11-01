// ==UserScript==
// @name         MufyCard 4.1
// @namespace    local.mufy.custom.scanner
// @version      4.1.0
// @description  MufyCard 4.1 正式版
// @match        https://chat.mufy.ai/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// @run-at       document-start
// ==/UserScript==
// 源：Anlyra%，禁二改、二传、任何商业化用途，感谢喜欢

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ================= 1. 凭证捕获（参考 MufyLink 的页面请求捕获方式） =================
  let authToken = '';
  const originalFetch = W.fetch.bind(W);

  function captureAuthorization(headers, requestUrl) {
    try {
      const url = new URL(String(requestUrl || ''), location.href);
      if (url.origin !== location.origin || !/(?:^|\/)api(?:\/|$)/i.test(url.pathname)) return;
      const candidate = new W.Headers(headers || {}).get('authorization') || '';
      if (/^Bearer\s+\S+/i.test(candidate)) authToken = candidate;
    } catch (_) {}
  }

  function scanStoredAuth() {
    if (authToken) return authToken;
    const storages = [];
    try { if (W.localStorage) storages.push(W.localStorage); } catch (_) {}
    try { if (W.sessionStorage) storages.push(W.sessionStorage); } catch (_) {}
    for (const storage of storages) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = String(storage.key(i) || '');
          if (!/(token|authorization|access.?token|jwt)/i.test(key)) continue;
          const rawValue = String(storage.getItem(key) || '').replace(/^"|"$/g, '');
          let nestedValue = '';
          try {
            const parsed = JSON.parse(rawValue);
            nestedValue = String(parsed?.accessToken || parsed?.access_token || parsed?.token || parsed?.authorization || '');
          } catch (_) {}
          const value = nestedValue || rawValue;
          const candidate = /^Bearer\s+\S+/i.test(value)
            ? value
            : (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value) ? `Bearer ${value}` : '');
          if (candidate) { authToken = candidate; return authToken; }
        }
      } catch (_) {}
    }
    return '';
  }

  // 捕获网站自身 fetch 请求携带的 Bearer 令牌。
  try {
    if (W.fetch && !W.fetch.__mufyCardAuthHooked) {
      const pageFetch = W.fetch;
      const wrappedFetch = function (input, init) {
        let requestUrl = '';
        try { requestUrl = typeof input === 'string' ? input : input?.url || String(input || ''); } catch (_) {}
        try { captureAuthorization(init?.headers, requestUrl); } catch (_) {}
        try { captureAuthorization(input?.headers, requestUrl); } catch (_) {}
        return pageFetch.apply(this, arguments);
      };
      wrappedFetch.__mufyCardAuthHooked = true;
      W.fetch = wrappedFetch;
    }
  } catch (_) {}

  // 网站部分请求可能由 XMLHttpRequest 发出；只拦截同源 API 的 Authorization 请求头。
  try {
    const XHR = W.XMLHttpRequest;
    if (XHR && !XHR.prototype.__mufyCardAuthHooked) {
      const originalOpen = XHR.prototype.open;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function (method, url) {
        this.__mufyCardRequestUrl = String(url || '');
        return originalOpen.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (name, value) {
        if (/^authorization$/i.test(String(name))) {
          captureAuthorization({ authorization: value }, this.__mufyCardRequestUrl);
        }
        return originalSetRequestHeader.apply(this, arguments);
      };
      XHR.prototype.__mufyCardAuthHooked = true;
    }
  } catch (_) {}

  async function apiRequest(path, method = 'GET', body = null) {
    // 每次操作前重新检查网站存储；避免脚本启动时还没有登录令牌。
    scanStoredAuth();
    const url = new URL(path, location.origin);
    const requestBody = body ? JSON.stringify(body) : undefined;
    const send = (token) => {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = token;
      if (body) headers['Content-Type'] = 'application/json';
      return originalFetch(url.href, { method, headers, credentials: 'include', body: requestBody });
    };
    let resp = await send(authToken);
    // 旧令牌可能已经过期；清除后再尝试一次网站 Cookie 会话。
    if (resp.status === 401 && authToken) {
      authToken = '';
      resp = await send('');
    }
    const responseText = await resp.text();
    let json = null;
    try { json = responseText ? JSON.parse(responseText) : null; } catch (_) {}
    if (!resp.ok) {
      if (resp.status === 401) {
        throw new Error('HTTP 401：网站没有接受当前登录凭证。请在同一 ChatMufy.ai 页面确认已登录，并打开一个角色聊天后再重试。');
      }
      const detail = json?.message || json?.reason || responseText || `HTTP ${resp.status}`;
      throw new Error(`HTTP ${resp.status}${detail && detail !== `HTTP ${resp.status}` ? `：${detail}` : ''}`);
    }
    if (json && Object.prototype.hasOwnProperty.call(json, 'code') && Number(json.code) !== 200) {
      throw new Error(json.message || json.reason || `接口返回 code=${json.code}`);
    }
    if (json && Object.prototype.hasOwnProperty.call(json, 'data')) return json.data;
    return json;
  }

  // ================= 2. 界面样式 (CSS) =================
  const CSS = `
    :host {
      --bg: rgba(28, 28, 35, 0.98);
      --fg: #f0f0f5;
      --dim: #8e8e9e;
      --accent: #6d5ae6;
      --border: #3f3f4a;
      font: 13px/1.5 system-ui, -apple-system, sans-serif;
      color: var(--fg);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    /* 4.0 Preview 3：避免原生控件或未指定样式出现黑色文字 */
    button, input, textarea, select, option { color: #d8d8e2; }
    input::placeholder, textarea::placeholder { color: #9292a3; opacity: 1; }
    #drag-handle {
      position: fixed; z-index: 2147483646;
      background: #1e1e24cc; border: 1px solid var(--border);
      backdrop-filter: blur(10px); box-shadow: 0 4px 16px #0008;
      cursor: pointer; transition: transform .2s, border-radius .2s, width .2s, height .2s;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 20px; opacity: .7;
      user-select: none; touch-action: none;
    }
    #drag-handle:hover { opacity: 1; background: #2a2a35cc; }
    #drag-handle.is-ball { width: 48px; height: 48px; border-radius: 50%; }
    #drag-handle.is-bar { width: 36px; height: 104px; border-radius: 18px; }
    #drag-handle .handle-dots { display:inline-block; line-height:1; font-size:20px; }
    #drag-handle.is-left-bar .handle-dots { transform: translateX(7px); }
    #drag-handle.is-right-bar .handle-dots { transform: translateX(-7px); }
    /* 2.8：恢复窄长条侧边栏，而不是居中的浮窗 */
    #panel {
      position: fixed; z-index: 2147483647;
      top: 20vh; right: 8px; bottom: auto; left: auto;
      width: min(400px, 90vw); height: min(600px, 72vh); max-height: 82vh;
      min-width: 260px; min-height: 300px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 14px; box-shadow: 0 12px 40px #0008;
      display: flex; flex-direction: column; overflow: hidden;
    }
    #panel[hidden] { display: none !important; }
    @media (max-width: 520px) {
      #panel { top: 12vh; bottom: auto; width: 90vw; height: min(600px, 72vh); min-width: 260px; min-height: 300px; border-radius: 14px; }
    }
    .header {
      padding: 5px 10px; background: #ffffff08; border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; cursor: move;
      touch-action: none;
    }
    .header .title { font-weight: 700; color: #ffffff !important; }
    .header .close { cursor: pointer; color: var(--dim); font-size: 20px; line-height:1; padding: 0 4px; border:0; background:transparent; }
    .header-actions { display:flex; align-items:center; gap:10px; flex:0 0 auto; }
    .export-btn { border:1px solid #514b7d; border-radius:6px; padding:4px 9px; background:#302a48; color:#f2efff; font-size:11px; cursor:pointer; }
    .export-btn:active { background:#51458f; }
    .tab-btn.tab-more { flex:0 0 48px; padding-left:4px; padding-right:4px; }
    #more-page { display:none; flex:1; min-height:0; overflow-y:auto; padding:10px; }
    #more-page.active { display:block; }
    .more-title { font-weight:700; margin:2px 0 10px; }
    .more-entry { width:100%; text-align:left; padding:12px; margin-bottom:8px; border:1px solid var(--border); border-radius:10px; color:var(--fg); background:#ffffff06; cursor:pointer; }
    .more-entry small { display:block; color:var(--dim); margin-top:3px; }
    .command-list { flex:1 1 0; min-height:0; overflow-y:auto; padding:9px; display:flex; flex-direction:column; gap:8px; }
    .command-card { display:flex; align-items:center; gap:8px; width:100%; min-width:0; padding:10px; border:1px solid var(--border); border-radius:9px; background:#ffffff06; color:var(--fg); }
    .command-card-main { flex:1; min-width:0; text-align:left; }
    .command-card-name { font-size:13px; font-weight:650; overflow-wrap:anywhere; }
    .command-card-preview { color:var(--dim); font-size:11px; line-height:1.35; margin-top:4px; white-space:pre-wrap; overflow-wrap:anywhere; max-height:2.7em; overflow:hidden; }
    .command-card-tag { color:#b9addf; font-size:10px; margin-top:4px; }
    .command-card button { flex:0 0 auto; border:1px solid var(--border); border-radius:7px; padding:6px 8px; background:#302a48; color:#f2efff; }
    #wardrobe-page { display:none; flex:1; min-height:0; overflow:hidden; flex-direction:column; }
    #wardrobe-page.active { display:flex; }
    .sticker-layout{display:flex;flex:1;min-height:0;overflow:hidden}.sticker-cats{width:72px;flex:0 0 72px;overflow:auto;border-right:1px solid var(--border);padding:7px 5px;display:flex;flex-direction:column;gap:6px}.sticker-cat{border:0;border-left:3px solid transparent;background:#ffffff08;color:var(--fg);padding:9px 4px;border-radius:0 8px 8px 0;font-size:11px;overflow-wrap:anywhere}.sticker-cat.active{border-left-color:#b7a1f2;background:#8b73cb25}.sticker-content{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}.sticker-grid{overflow-y:auto;overflow-x:hidden;min-height:0;height:0;flex:1 1 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:max-content;align-content:start;align-items:start;gap:8px;padding:8px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}.sticker-card{box-sizing:border-box;aspect-ratio:1/1;width:100%;min-width:0;min-height:0;align-self:start;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:#17151e;position:relative;display:flex;flex-direction:column}.sticker-preview{flex:1 1 0;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;background:#17151e;overflow:hidden}.sticker-preview img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.sticker-actions{box-sizing:border-box;flex:0 0 30px;min-height:30px;display:flex;flex-direction:row;align-items:center;gap:4px;padding:3px 4px;background:#17151e}.sticker-actions button{box-sizing:border-box;height:24px;min-height:24px;max-height:24px;min-width:0;margin:0;padding:2px 4px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:6px!important;color:#fff!important;box-shadow:none!important}.sticker-copy{flex:1 1 0;font-size:10px;font-weight:650;background:transparent!important;border:1px solid #75659b!important;color:#fff!important}.sticker-edit{flex:0 0 42px;width:42px;font-size:10px;background:#51416f!important;border:1px solid #75659b!important;color:#fff!important}.sticker-select{position:absolute;top:6px;left:6px;width:20px;height:20px;z-index:2}.note-list{flex:1;min-height:0;overflow:auto;padding:5px 12px}.note-swipe{position:relative;overflow:hidden;border-bottom:1px solid var(--border);touch-action:pan-y}.note-swipe-actions{position:absolute;inset:0 0 0 auto;display:flex;align-items:stretch;gap:0}.note-swipe-actions button{min-width:62px;border:0;color:#f4efff;background:#51416f;font-size:11px}.note-swipe-actions button[data-note-delete]{background:#75465c}.note-row{position:relative;z-index:1;padding:12px 2px;background:var(--bg);text-align:left;cursor:pointer;transition:transform .18s ease;will-change:transform}.note-row.swiped{transform:translateX(-124px)}.note-title{font-weight:650;font-size:14px}.note-preview{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.note-meta{font-size:10px;color:var(--dim);margin-top:5px}.note-editor{position:absolute;inset:0;background:var(--bg);z-index:4;display:flex;flex-direction:column;padding:10px;gap:8px}.note-editor input,.note-editor textarea{background:transparent;color:var(--fg);border:0;outline:none;width:100%;font:inherit}.note-editor input{font-size:20px;font-weight:700;padding:8px 2px}.note-editor textarea{flex:1;resize:none;font-size:15px;line-height:1.65;padding:4px 2px}.note-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px}.note-toolbar button{border:1px solid var(--border);border-radius:7px;background:#302a48;color:#f2efff;padding:7px 10px}.note-editor .note-toolbar [data-pin],.note-editor .note-toolbar [data-delete]{display:none}

    .wardrobe-head { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--border); }
    .wardrobe-head > :first-child { justify-self:start; }
    .wardrobe-head > strong { grid-column:2; justify-self:center; text-align:center; min-width:0; max-width:100%; }
    .wardrobe-head > :last-child { justify-self:end; }
    .wardrobe-head button,.wardrobe-tools button,.wardrobe-card button,.wardrobe-detail button { border:1px solid var(--border); border-radius:7px; padding:6px 9px; background:#302a48; color:#f2efff; cursor:pointer; }
    .wardrobe-tools { padding:8px; display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--border); }
    .wardrobe-tools select { min-width:0; flex:1; background:#202027; color:var(--fg); border:1px solid var(--border); border-radius:7px; padding:6px; }
    .wardrobe-grid { overflow-y:auto; overflow-x:hidden; min-height:0; height:0; flex:1 1 0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:max-content; align-content:start; align-items:start; gap:8px; padding:8px; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
    .wardrobe-card { min-width:0; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:#ffffff05; position:relative; }
    .wardrobe-card .wardrobe-thumb { width:100%; aspect-ratio:4/3; object-fit:cover; display:block; background:#25252e; }
    .wardrobe-card .wardrobe-noimg { width:100%; aspect-ratio:4/3; display:flex; align-items:center; justify-content:center; background:linear-gradient(145deg,#292735,#1d1d24); color:#8e8e9e; font-size:12px; }
    .wardrobe-card .wardrobe-cardtext { padding:5px 6px; }
    .wardrobe-card .wardrobe-name { font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .wardrobe-card .wardrobe-desc { color:var(--dim); font-size:11px; line-height:1.35; height:2.7em; overflow:hidden; margin-top:4px; overflow-wrap:anywhere; }
    .wardrobe-card .wardrobe-copy { display:block; width:100%; margin-top:4px; padding:3px 7px; border:0 !important; background:transparent !important; box-shadow:none !important; color:#aaa4c8 !important; font-size:10px; }
    .wardrobe-detail-backdrop { position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; padding:14px; background:#0009; }
    .wardrobe-detail { width:100%; max-height:90%; overflow:auto; border:1px solid var(--border); border-radius:14px; background:#202027; box-shadow:0 12px 36px #0009; padding:10px; }
    .wardrobe-detail img { width:100%; max-height:220px; object-fit:contain; border-radius:8px; background:#15151b; }
    .wardrobe-detail .detail-desc { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; margin:10px 0; }
    .wardrobe-detail input,.wardrobe-detail textarea,.wardrobe-detail select { width:100%; margin:5px 0 8px; padding:8px; border-radius:7px; border:1px solid var(--border); background:#15151b; color:var(--fg); }
    .wardrobe-detail textarea { min-height:120px; resize:vertical; }
    .wardrobe-detail .detail-actions { display:flex; gap:6px; flex-wrap:wrap; }
    /* 文字统一使用白色/灰色，包括用户输入的描述与衣柜标题 */
    #panel, #panel * { color: #e8e8ee !important; }
    #panel input, #panel textarea, #panel select, #panel option { color:#eeeeF4 !important; -webkit-text-fill-color:#eeeeF4; }
    #panel input::placeholder, #panel textarea::placeholder { color:#a6a6b4 !important; -webkit-text-fill-color:#a6a6b4; }
    #panel .wardrobe-head strong, #panel .wardrobe-desc, #panel .detail-desc, #panel .wardrobe-detail strong { color:#f2f2f5 !important; }
    #panel .wardrobe-card .wardrobe-thumb { object-position: center 42%; }
    .wardrobe-card.is-selected { outline:2px solid #9a8cff; background:#8b7bff22; }
    .wardrobe-select-box { position:absolute; top:7px; left:7px; z-index:2; width:22px !important; height:22px; accent-color:#8b7bff; }
    .wardrobe-bulk-status { align-self:center; color:#c9c9d4 !important; font-size:11px; }
    .wardrobe-music { flex:0 0 auto; padding:8px; border-top:1px solid var(--border); background:#ffffff05; display:grid; gap:6px; }
    .wardrobe-music .music-title { font-size:12px; font-weight:700; }
    .wardrobe-music .music-row { display:flex; gap:6px; align-items:center; min-width:0; }
    .wardrobe-music input[type=url] { flex:1; min-width:0; width:0; padding:7px; border-radius:7px; border:1px solid var(--border); background:#15151b; color:#eeeef4; }
    .wardrobe-music button { border:1px solid var(--border); border-radius:7px; padding:6px 8px; background:#302a48; color:#f2efff; cursor:pointer; white-space:nowrap; }
    .wardrobe-music .music-status { color:#aaaab8 !important; font-size:11px; overflow-wrap:anywhere; }
    .wardrobe-music input[type=range] { width:74px; }
    .archive-toolbar { padding:6px 8px 4px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:6px; }
    .toolbar { padding: 2px 7px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
    .scan-controls { display:flex; width:100%; gap:0; overflow:hidden; border-radius:8px; }
    .scan-controls.single .btn-scan { flex:1; border-radius:8px; }
    .scan-controls.running .btn-scan { flex:2; border-radius:8px 0 0 8px; }
    .scan-controls .btn-pause { display:none; }
    .scan-controls.running .btn-pause { display:block; }
    .btn-scan {
      flex:2; min-width:0; padding:4px 6px; border-radius:8px 0 0 8px; border: none;
      background: #8b7bff; color: #fff; font-weight: 650; cursor: pointer;
    }
    .btn-scan:disabled { opacity: .85; cursor:default; }
    .btn-pause { flex:1; min-width:0; padding:4px 4px; border:0; border-left:1px solid #ffffff20; border-radius:0 8px 8px 0; background:#777783; color:#fff; font-size:11px; font-weight:600; cursor:pointer; }
    .btn-pause:disabled { opacity:.55; cursor:default; }
    .btn-auth, .bulk-fav button {
      width: 100%; padding: 3px 6px; border-radius: 6px; border: 1px dashed var(--dim);
      background: transparent; color: var(--dim); font-size: 12px; cursor: pointer; margin-top: 4px;
    }
    .status { font-size: 10px; color: var(--dim); text-align: center; min-height: 13px; }
    .status.ok { color: #4ade80; }
    .status.err { color: #ff5c5c; }
    .phase-label { color: #e7e3ff; font-size: 10px; font-weight: 650; margin-bottom: 2px; }
    .progress-wrap { padding: 0 2px; }
    .progress-track { width: 100%; height: 7px; overflow: hidden; border-radius: 999px; background: #555563; border: 1px solid #ffffff16; }
    .progress-fill { width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #8b7bff, #4ade80); transition: width .18s ease; }
    .progress-caption { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; color: var(--dim); font-size: 10px; }
    .report-slider { height:58px; overflow-y:auto; overscroll-behavior:contain; scroll-snap-type:none; scrollbar-width:none; margin-top:1px; }
    .report-slider::-webkit-scrollbar { display:none; }
    .report-page { height:58px; min-height:58px; scroll-snap-align:none; scroll-snap-stop:normal; }
    .report { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); gap:3px; height:100%; }
    .report-page.secondary .report { grid-template-rows:repeat(2,minmax(0,1fr)); }
    .report-item { appearance:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; width:100%; height:100%; box-sizing:border-box; background:#ffffff08; border:1px solid #ffffff12; border-radius:6px; padding:2px 2px; text-align:center; min-width:0; color:inherit; cursor:pointer; overflow:hidden; }
    .report-item:active, .report-item.filter-active { background:#8b7bff24; border-color:#8b7bff99; }
    .report-num { display:block; font-size:clamp(12px, 3.6vw, 16px); line-height:1.15; font-weight:750; color:#fff; max-width:100%; }
    .report-label { display:block; font-size:clamp(8px, 2.5vw, 10px); line-height:1.15; color:var(--dim); overflow-wrap:anywhere; white-space:normal; max-width:100%; }
    .search-box { width:100%; background:#22222c; color:var(--fg); border:1px solid #4b4b5b; border-radius:7px; padding:5px 8px; font-size:12px; outline:none; }
    .search-help { color:var(--dim); font-size:10px; margin-top:-4px; }
    .bulk-fav { display:flex; gap:6px; align-items:center; }
    .bulk-fav button { flex:1; width:100%; margin-top:0; padding:3px 6px; border-style:solid; background:#3b326c; color:#fff; border-color:#6558a5; }
    .chat-bulk { display:flex; gap:5px; margin-top:2px; }
    .chat-bulk button { flex:1; min-width:0; border:1px solid #6558a5; border-radius:7px; padding:4px 6px; background:#302a48; color:#f2efff; font-size:11px; cursor:pointer; }
    .chat-bulk button:disabled { opacity:.55; cursor:wait; }
    .role-select { width:16px; height:16px; flex:0 0 auto; accent-color:#8b7bff; cursor:pointer; }
    .role-title-wrap { display:flex; align-items:center; gap:7px; min-width:0; }
    .role-title-wrap .role-name { min-width:0; }
    .toast { display:none; margin:0 12px 7px; padding:8px 10px; border-radius:8px; background:#292b3a; border:1px solid #514b7d; color:#f5f2ff; font-size:12px; overflow-wrap:anywhere; }
    .toast.show { display:block; }
    .tabs { display:flex; gap:6px; padding:4px 8px; border-bottom:1px solid var(--border); }
    .tab-btn { flex:1; border:1px solid #4a465f; border-radius:7px; padding:5px; background:#262530; color:#c9c6d8; font-weight:650; cursor:pointer; }
    .tab-btn.active { background:#51458f; border-color:#8273dc; color:#fff; }
    .mask-card { display:grid; grid-template-columns:minmax(74px, .75fr) minmax(0, 2fr); gap:10px; padding:10px; border:1px solid #51486f; border-radius:10px; background:#211f30; box-shadow:0 2px 8px #0002; cursor:pointer; }
    .mask-remark { display:flex; flex-direction:column; justify-content:center; padding:8px; border-radius:7px; background:#302a48; color:#f2efff; font-weight:750; overflow-wrap:anywhere; }
    .mask-remark small { color:#aaa2ca; font-size:10px; font-weight:500; margin-top:5px; }
    .mask-preview { min-width:0; color:#d8d4e8; font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
    .mask-preview strong { display:block; color:#fff; font-size:13px; margin-bottom:3px; }
    .mask-preview .mask-snippet { color:#aaa6bb; margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .mask-detail { grid-column:1/-1; border-top:1px solid #ffffff16; padding-top:8px; margin-top:2px; white-space:pre-wrap; overflow-wrap:anywhere; color:#d8d4e8; font-size:11px; }
    .mask-detail label { display:block; color:#b3a8ff; font-weight:700; margin-top:7px; }
    .mask-actions { display:flex; gap:6px; margin-top:8px; }
    .mask-actions button, .mask-add-btn { border:1px solid #6558a5; border-radius:7px; background:#3b326c; color:#fff; padding:6px 8px; font-size:11px; cursor:pointer; }
    .mask-form { padding:10px; border:1px solid #51486f; border-radius:10px; background:#211f30; display:flex; flex-direction:column; gap:6px; max-height:88%; overflow-y:auto; }
    .mask-modal { position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; padding:12px; box-sizing:border-box; background:#080810d9; }
    .mask-modal .mask-form { width:100%; max-width:440px; box-sizing:border-box; box-shadow:0 8px 32px #0009; }
    .mask-source-tabs { display:flex; gap:6px; }
    .mask-source-tabs button { flex:1; border:1px solid #51486f; border-radius:7px; padding:7px 8px; background:#262530; color:#c9c6d8; cursor:pointer; font-size:11px; }
    .mask-source-tabs button.active { background:#51458f; border-color:#8273dc; color:#fff; }
    .mask-form label { color:#fff !important; }
    .mask-modal .mask-form input, .mask-modal .mask-form textarea { color:#fff !important; -webkit-text-fill-color:#fff !important; caret-color:#fff; }
    .mask-modal .mask-form input::placeholder, .mask-modal .mask-form textarea::placeholder { color:#aaa6bb !important; opacity:1; }
    .mask-form input, .mask-form textarea, .mask-modal input, .mask-modal textarea { width:100%; box-sizing:border-box; background:#171622 !important; color:#fff !important; -webkit-text-fill-color:#fff; border:1px solid #4b4b5b; border-radius:6px; padding:7px; font:inherit; font-size:11px; }
    .mask-form textarea { min-height:65px; resize:vertical; }
    .mask-form .form-buttons { display:flex; gap:6px; }
    .mask-form .form-buttons button{background:#302747!important;color:#eee9fb!important;-webkit-text-fill-color:#eee9fb!important;border:1px solid #65558f!important;box-shadow:none!important;appearance:none;-webkit-appearance:none}
    .archive-list { gap:8px; background:linear-gradient(180deg,#171622,#111119); }
    .archive-card { border:1px solid #51486f; border-left:3px solid #8b7bff; border-radius:10px; padding:10px; background:#211f30; box-shadow:0 2px 8px #0002; }
    .archive-role-title { font-size:13px; line-height:1.45; font-weight:700; color:#f2efff; overflow-wrap:anywhere; }
    .archive-action { display:block; width:100%; margin-top:8px; border:1px solid #6558a5; border-radius:7px; background:#3b326c; color:#fff; padding:7px 8px; cursor:pointer; font-size:12px; }
    .archive-action:disabled { opacity:.65; cursor:wait; }
    .archive-entry { display:block; margin-top:7px; padding:9px 10px; border:1px solid #ffffff12; border-radius:7px; background:#171622; color:#d2c9ff; text-decoration:none; overflow-wrap:anywhere; font-size:12px; }
    .archive-error { margin-top:8px; color:#ffb4b4; font-size:11px; }
    .list-container { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:6px; -webkit-overflow-scrolling:touch; }
    .row { padding:10px 12px; border-radius:8px; background:#ffffff04; border:1px solid #ffffff0a; }
    .row-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .role-name { font-weight:600; font-size:14px; color:#fff; overflow-wrap:anywhere; }
    .role-link { display:inline-block; margin-top:3px; color:#a99cff; text-decoration:underline; font-size:11px; overflow-wrap:anywhere; }
    /* 4.0 原版状态配色 */
    .role-link,.role-link:visited{color:#a99cff!important}.fav-btn.is-fav{color:#ffd34d!important}.role-state.active,.status.ok{color:#4ade80!important}.role-state.deleted{color:#ff8585!important}.status.err{color:#ff5c5c!important}.role-state.unknown{color:#ffd580!important}
    .header .title { color:#fff; font-weight:750; }
    .fav-btn { min-width:30px; min-height:30px; border:0; background:transparent; padding:0; color:#a6a6b3; font-size:25px; line-height:1; cursor:pointer; }
    .fav-btn.is-fav { color:#ffd34d; }
    .fav-btn:disabled { opacity:.55; cursor:wait; }
    .row-meta { color:var(--dim); font-size:12px; margin-top:4px; overflow-wrap:anywhere; }
    .mask-tag { color:#b3a8ff; }
    .role-state { display:inline-block; margin-top:5px; padding:1px 6px; border-radius:5px; font-size:10px; border:1px solid #555; color:#bbb; }
    .role-state.active { color:#4ade80; border-color:#286b49; }
    .role-state.deleted { color:#ff8585; border-color:#854141; }
    .role-state.unknown { color:#ffd580; border-color:#79623b; }
    .resize-grip { position:absolute; right:0; bottom:0; width:30px; height:30px; cursor:se-resize; z-index:10; touch-action:none; background:linear-gradient(135deg,transparent 50%,#666 50%,#666 60%,transparent 60%,transparent 70%,#666 70%,#666 80%,transparent 80%); opacity:.6; }
    @media (max-width:520px) { #panel { width:90vw; height:min(600px,72vh); max-height:82vh; } }
  `;

  // ================= 3. DOM 构建 =================
  let host, shadow, dragHandle, panel, listContainer, resizeGrip, statusText, progressFill, progressPercent, phaseLabel;
  let scannedRoles = [];
  let activeTab = 'roles';
  const selectedRoleIds = new Set();
  let activeRoleFilter = 'all';
  let chatHiRunning = false;
  let chatHiStopRequested = false;
  // 每个版本使用独立缓存，避免升级后误读旧版扫描结果/恢复进度。
  function currentAccountCacheId(){
    try {
      scanStoredAuth();
      const token=String(authToken||'').replace(/^Bearer\s+/i,'');
      if(!token)return 'anonymous';
      const part=token.split('.')[1];
      if(part){
        const decoded=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
        const identity=decoded.userId||decoded.user_id||decoded.uid||decoded.sub||decoded.id;
        if(identity!==undefined&&identity!==null)return 'u'+String(identity).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48);
      }
      let hash=2166136261;for(let i=0;i<token.length;i++){hash^=token.charCodeAt(i);hash=Math.imul(hash,16777619);}return 't'+(hash>>>0).toString(36);
    }catch(_){return 'anonymous';}
  }
  const ACCOUNT_CACHE_ID = currentAccountCacheId();
  const CACHE_VERSION = 'v3_3_7_preview6';
  const SCAN_CACHE_STABLE_KEY = `mufycard_scan_cache_stable_${ACCOUNT_CACHE_ID}`;
  const ARCHIVE_CACHE_STABLE_KEY = `mufycard_archive_cache_stable_${ACCOUNT_CACHE_ID}`;
  const SCAN_RESUME_STABLE_KEY = `mufycard_scan_resume_stable_${ACCOUNT_CACHE_ID}`;
  let scanCacheEpoch = 0;
  let scanCacheWriteQueue = Promise.resolve();
  const MASK_CACHE_KEY = `mufycard_masks_local_${CACHE_VERSION}`;
  // 稳定键不随预览版本变化，避免版本升级/刷新后读不到用户创建的面具。
  const MASK_STABLE_CACHE_KEY = `mufycard_masks_local_${ACCOUNT_CACHE_ID}`;
  const MASK_REMOTE_CACHE_KEY = `mufycard_masks_remote_${CACHE_VERSION}`;
  let remoteMasks = [];
  let localMasks = [];
  let expandedMaskId = '';
  let maskSearchQuery = '';
  let maskView = 'local';
  let scanMode = 'full';

  const SCAN_CACHE_KEY = `mufycard_scan_cache_${CACHE_VERSION}_${ACCOUNT_CACHE_ID}`;
  const ARCHIVE_CACHE_KEY = `mufycard_archive_cache_${CACHE_VERSION}_${ACCOUNT_CACHE_ID}`;
  const SCAN_RESUME_KEY = `mufycard_scan_resume_${CACHE_VERSION}_${ACCOUNT_CACHE_ID}`;
  // 扫描数据优先保存到脚本管理器的 GM 存储，避免依赖网站页面的 localStorage/临时状态。
  // localStorage 仅作为兼容性备份；读取时先检查 GM，再检查页面存储。
  // 持久化存储兼容：不同脚本管理器的 GM API 可能返回 Promise，必须 await 后再解析。
  async function persistentReadAsync(key, fallback = null) {
    try {
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
        const v = await GM.getValue(key, undefined);
        if (v !== undefined && v !== null && v !== '') return v;
      }
    } catch (e) { console.debug('[MufyCard] GM.getValue 读取失败', key, e); }
    try {
      if (typeof GM_getValue === 'function') {
        const v = await GM_getValue(key, undefined);
        if (v !== undefined && v !== null && v !== '') return v;
      }
    } catch (e) { console.debug('[MufyCard] GM_getValue 读取失败', key, e); }
    try { const v = W.localStorage.getItem(key); if (v !== null && v !== '') return v; } catch (_) {}
    try { const v = localStorage.getItem(key); if (v !== null && v !== '') return v; } catch (_) {}
    return fallback;
  }
  async function persistentWrite(key, value) {
    let successes = [];
    // localStorage 同步落盘，先保证刷新前有一份可恢复副本。
    for (const storage of [(() => { try { return W.localStorage; } catch (_) { return null; } })(), (() => { try { return localStorage; } catch (_) { return null; } })()]) {
      if (!storage) continue;
      try { storage.setItem(key, value); if (storage.getItem(key) === value) successes.push('localStorage'); } catch (e) { console.debug('[MufyCard] localStorage 写入失败', key, e); }
    }
    // GM API 可能是异步 Promise；必须 await 并回读验证，不能仅因调用未抛错就报告成功。
    try {
      if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
        await GM.setValue(key, value);
        if (typeof GM.getValue === 'function' && (await GM.getValue(key, null)) === value) successes.push('GM');
      }
    } catch (e) { console.error('[MufyCard] GM.setValue 写入失败', key, e); }
    try {
      if (typeof GM_setValue === 'function') {
        await GM_setValue(key, value);
        if (typeof GM_getValue === 'function' && (await GM_getValue(key, null)) === value) successes.push('GM_legacy');
      }
    } catch (e) { console.error('[MufyCard] GM_setValue 写入失败', key, e); }
    if (!successes.length) console.error('[MufyCard] 持久化写入未能回读验证：', key);
    return successes.length > 0;
  }
  function persistentRemove(key) {
    try { if (typeof GM !== 'undefined' && typeof GM.deleteValue === 'function') Promise.resolve(GM.deleteValue(key)).catch(() => {}); } catch (_) {}
    try { if (typeof GM_deleteValue === 'function') Promise.resolve(GM_deleteValue(key)).catch(() => {}); } catch (_) {}
    try { W.localStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }
  function saveResumeState(state) {
    try { const raw = JSON.stringify({ ...state, updatedAt: Date.now() }); void persistentWrite(SCAN_RESUME_KEY, raw); void persistentWrite(SCAN_RESUME_STABLE_KEY, raw); } catch (e) { console.error('[MufyCard] 保存扫描恢复进度失败', e); }
  }
  async function loadResumeState() {
    for (const key of [SCAN_RESUME_KEY, SCAN_RESUME_STABLE_KEY]) { try { const state = JSON.parse(await persistentReadAsync(key, 'null') || 'null'); if (state && ['list', 'details'].includes(state.phase)) return state; } catch (_) {} }
    return null;
  }
  function clearResumeState() { persistentRemove(SCAN_RESUME_KEY); persistentRemove(SCAN_RESUME_STABLE_KEY); }
  async function saveScanCache() {
    const epoch = scanCacheEpoch;
    let payload;
    try { payload = JSON.stringify({ schema: 2, savedAt: Date.now(), roles: scannedRoles }); }
    catch (e) { console.error('[MufyCard] 序列化扫描缓存失败', e); return; }
    // 先同步写入稳定备份，避免扫描结束后立刻刷新时，排队中的异步写入尚未执行。
    for (const key of [SCAN_CACHE_KEY, SCAN_CACHE_STABLE_KEY]) {
      try { W.localStorage.setItem(key, payload); } catch (e) { console.debug('[MufyCard] 页面 localStorage 快照写入失败', key, e); }
      try { localStorage.setItem(key, payload); } catch (_) {}
    }
    scanCacheWriteQueue = scanCacheWriteQueue.catch(() => {}).then(async () => {
      // 若用户在等待期间点了清空，丢弃旧快照，防止清空后旧数据又写回来。
      if (epoch !== scanCacheEpoch) return;
      const results = await Promise.all([persistentWrite(SCAN_CACHE_KEY, payload), persistentWrite(SCAN_CACHE_STABLE_KEY, payload)]);
      if (!results.some(Boolean)) console.error('[MufyCard] 扫描缓存没有任何可用的存储通道');
    });
    await scanCacheWriteQueue;
  }
  async function loadScanCache() {
    const keys = [SCAN_CACHE_KEY, SCAN_CACHE_STABLE_KEY];
    const candidates = [];
    for (const key of keys) {
      try {
        const raw = await persistentReadAsync(key, null);
        const saved = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
        if (saved && Array.isArray(saved.roles)) candidates.push({ key, saved, raw });
      } catch (e) { console.debug('[MufyCard] 扫描缓存读取失败', key, e); }
    }
    // 兼容旧 Preview：旧扫描结果可能只存在 Tampermonkey GM 存储，
    // 不能只枚举网页 localStorage。分别枚举 GM 与页面存储中的旧键，再按账号后缀筛选。
    if (!candidates.length) {
      const prefixes = ['mufycard_scan_cache_', 'mufycard_scan_cache_stable_'];
      const legacyKeys = new Set();
      const matchesCurrentAccount = key => key.endsWith(`_${ACCOUNT_CACHE_ID}`) && prefixes.some(prefix => key.startsWith(prefix));
      try {
        if (typeof GM_listValues === 'function') {
          const names = await GM_listValues();
          for (const key of (Array.isArray(names) ? names : [])) if (matchesCurrentAccount(String(key))) legacyKeys.add(String(key));
        }
      } catch (e) { console.debug('[MufyCard] GM_listValues 枚举旧扫描缓存失败', e); }
      try {
        if (typeof GM !== 'undefined' && typeof GM.listValues === 'function') {
          const names = await GM.listValues();
          for (const key of (Array.isArray(names) ? names : [])) if (matchesCurrentAccount(String(key))) legacyKeys.add(String(key));
        }
      } catch (e) { console.debug('[MufyCard] GM.listValues 枚举旧扫描缓存失败', e); }
      try {
        for (let i = 0; i < W.localStorage.length; i++) {
          const key = W.localStorage.key(i);
          if (key && matchesCurrentAccount(key)) legacyKeys.add(key);
        }
      } catch (_) {}
      for (const key of legacyKeys) {
        try {
          const raw = await persistentReadAsync(key, null);
          const saved = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
          if (saved && Array.isArray(saved.roles)) candidates.push({ key, saved, raw });
        } catch (e) { console.debug('[MufyCard] 旧版扫描缓存读取失败', key, e); }
      }
    }
    if (!candidates.length) { console.warn('[MufyCard] 没有找到可恢复的扫描缓存'); return false; }
    candidates.sort((a,b) => (Number(b.saved.savedAt)||0) - (Number(a.saved.savedAt)||0));
    const chosen = candidates[0];
    scannedRoles = chosen.saved.roles;
    // 同步将恢复到的最新快照写入稳定键，避免旧版缓存覆盖新结果。
    const raw = JSON.stringify({ schema: 2, savedAt: Number(chosen.saved.savedAt)||Date.now(), roles: scannedRoles });
    for (const key of [SCAN_CACHE_KEY, SCAN_CACHE_STABLE_KEY]) {
      try { W.localStorage.setItem(key, raw); } catch (_) {}
      try { localStorage.setItem(key, raw); } catch (_) {}
    }
    if (chosen.key !== SCAN_CACHE_KEY || !chosen.saved.schema) void saveScanCache();
    console.info(`[MufyCard] 已从持久化缓存恢复 ${scannedRoles.length} 个角色（${chosen.key}）`);
    return true;
  }
  async function loadMaskCaches() {
    const storageCandidates = [];
    try { if (typeof localStorage !== 'undefined') storageCandidates.push(localStorage); } catch (_) {}
    try { if (W.localStorage && !storageCandidates.includes(W.localStorage)) storageCandidates.push(W.localStorage); } catch (_) {}
    let raw = '';
    // 支持 Tampermonkey/兼容管理器的新旧两套 API；本地面具不依赖扫描是否已开始。
    try { if (typeof GM_getValue === 'function') raw = GM_getValue(MASK_STABLE_CACHE_KEY, '') || GM_getValue(MASK_CACHE_KEY, '') || ''; } catch (e) { console.debug('[MufyCard] legacy GM 读取失败', e); }
    try { if (!raw && typeof GM !== 'undefined' && typeof GM.getValue === 'function') raw = (await GM.getValue(MASK_STABLE_CACHE_KEY, '')) || (await GM.getValue(MASK_CACHE_KEY, '')) || ''; } catch (e) { console.debug('[MufyCard] modern GM 读取失败', e); }
    for (const storage of storageCandidates) {
      try { raw = raw || storage.getItem(MASK_STABLE_CACHE_KEY) || storage.getItem(MASK_CACHE_KEY) || ''; } catch (_) {}
      if (raw) break;
    }
    if (!raw) {
      for (const legacyKey of ['mufycard_masks_local_v3_3_7_preview6','mufycard_masks_local_v3_3_7_preview5','mufycard_masks_local_v3_3_7_preview4','mufycard_masks_local_v3_3_7_preview3','mufycard_masks_local_v3_3_7_preview2']) {
        for (const storage of storageCandidates) { try { raw = storage.getItem(legacyKey) || ''; } catch (_) {} if (raw) break; }
        if (raw) break;
      }
    }
    try {
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) {
        localMasks = parsed.filter(item => item && typeof item === 'object').map((item, i) => ({ ...item, localId: item.localId || `local-migrated-${item.createdAt || 'old'}-${i}`, source: 'local' }));
        const normalized = JSON.stringify(localMasks);
        try { if (typeof GM_setValue === 'function') { GM_setValue(MASK_STABLE_CACHE_KEY, normalized); GM_setValue(MASK_CACHE_KEY, normalized); } } catch (_) {}
        try { if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') { await GM.setValue(MASK_STABLE_CACHE_KEY, normalized); await GM.setValue(MASK_CACHE_KEY, normalized); } } catch (_) {}
        for (const storage of storageCandidates) { try { storage.setItem(MASK_STABLE_CACHE_KEY, normalized); storage.setItem(MASK_CACHE_KEY, normalized); } catch (_) {} }
      }
    } catch (e) { console.warn('[MufyCard] 本地面具缓存 JSON 损坏，暂不覆盖原始缓存', e); }
    try {
      let remoteRaw = '';
      for (const storage of storageCandidates) { try { remoteRaw = remoteRaw || storage.getItem(MASK_REMOTE_CACHE_KEY) || storage.getItem('mufycard_masks_remote_v3_3_7_preview6') || storage.getItem('mufycard_masks_remote_v3_3_7_preview5') || storage.getItem('mufycard_masks_remote_v3_3_7_preview4') || ''; } catch (_) {} }
      const parsed = JSON.parse(remoteRaw || '[]'); if (Array.isArray(parsed)) remoteMasks = parsed;
    } catch (e) { console.warn('[MufyCard] 读取已缓存面具失败', e); }
  }
  async function saveLocalMasks() {
    const serialized = JSON.stringify(localMasks);
    const successes = [];
    try { if (typeof GM_setValue === 'function' && typeof GM_getValue === 'function') { GM_setValue(MASK_STABLE_CACHE_KEY, serialized); GM_setValue(MASK_CACHE_KEY, serialized); if (GM_getValue(MASK_STABLE_CACHE_KEY, '') === serialized) successes.push('GM'); } } catch (e) { console.debug('[MufyCard] legacy GM 保存失败', e); }
    try { if (typeof GM !== 'undefined' && typeof GM.setValue === 'function' && typeof GM.getValue === 'function') { await GM.setValue(MASK_STABLE_CACHE_KEY, serialized); await GM.setValue(MASK_CACHE_KEY, serialized); if ((await GM.getValue(MASK_STABLE_CACHE_KEY, '')) === serialized) successes.push('GM4'); } } catch (e) { console.debug('[MufyCard] modern GM 保存失败', e); }
    try { if (typeof localStorage !== 'undefined') { localStorage.setItem(MASK_STABLE_CACHE_KEY, serialized); localStorage.setItem(MASK_CACHE_KEY, serialized); if (localStorage.getItem(MASK_STABLE_CACHE_KEY) === serialized) successes.push('sandbox-localStorage'); } } catch (e) { console.debug('[MufyCard] 沙盒 localStorage 保存失败', e); }
    try { W.localStorage.setItem(MASK_STABLE_CACHE_KEY, serialized); W.localStorage.setItem(MASK_CACHE_KEY, serialized); if (W.localStorage.getItem(MASK_STABLE_CACHE_KEY) === serialized) successes.push('page-localStorage'); } catch (e) { console.debug('[MufyCard] 页面 localStorage 保存失败', e); }
    if (!successes.length) {
      console.error('[MufyCard] 本地面具所有存储通道均失败。请检查脚本管理器权限与控制台详细错误。');
      showToast('本地面具保存失败：脚本管理器存储与网页存储都不可用。请确认脚本管理器允许该脚本使用存储。', 'err');
      return false;
    }
    console.info('[MufyCard] 本地面具保存成功：', successes.join(', '));
    return true;
  }
    function saveRemoteMasks() { try { W.localStorage.setItem(MASK_REMOTE_CACHE_KEY, JSON.stringify(remoteMasks)); } catch (_) {} }
  function saveArchiveCache() {
    try { const raw = JSON.stringify([...archiveCache.entries()]); for (const key of [ARCHIVE_CACHE_KEY, ARCHIVE_CACHE_STABLE_KEY]) { try { W.localStorage.setItem(key, raw); } catch (_) {} try { localStorage.setItem(key, raw); } catch (_) {} } void persistentWrite(ARCHIVE_CACHE_KEY, raw); void persistentWrite(ARCHIVE_CACHE_STABLE_KEY, raw); } catch (e) { console.debug('[MufyCard] 存档缓存保存失败', e); }
  }
  async function loadArchiveCache() {
    try {
      let raw = await persistentReadAsync(ARCHIVE_CACHE_KEY, null);
      if (!raw) raw = await persistentReadAsync(ARCHIVE_CACHE_STABLE_KEY, '[]');
      const saved = JSON.parse(raw || '[]');
      if (Array.isArray(saved)) saved.forEach(pair => { if (Array.isArray(pair) && pair.length === 2) archiveCache.set(String(pair[0]), pair[1]); });
    } catch (e) { console.debug('[MufyCard] 存档缓存读取失败', e); }
  }
  const archiveCache = new Map();
  const archiveLoadingIds = new Set();
  const expandedArchiveIds = new Set();
  let toastTimer = null;
  let scanRunning = false;
  let scanPaused = false;
  let scanCancelRequested = false;
  let pauseWaiters = [];

  async function waitIfPaused() {
    while (scanPaused) await new Promise(resolve => pauseWaiters.push(resolve));
  }
  function setScanPaused(paused) {
    scanPaused = paused;
    const main = panel?.querySelector('#btn-scan');
    const pause = panel?.querySelector('#btn-pause');
    const controls = panel?.querySelector('#scan-controls');
    if (controls) controls.classList.toggle('running', !!scanRunning);
    if (controls) controls.classList.toggle('single', !scanRunning);
    if (main) { main.textContent = paused ? '继续扫描' : (scanRunning ? '正在扫描…' : '开始扫描'); main.disabled = scanRunning && !paused; }
    if (pause) { pause.textContent = '暂停扫描'; pause.disabled = !scanRunning || paused; }
    if (paused) updateStatus('⏸ 扫描已暂停；点击「继续扫描」恢复');
    else if (scanRunning) { updateStatus('▶ 正在继续扫描…'); const waiters = pauseWaiters.splice(0); waiters.forEach(resolve => resolve()); }
  }

  function initUI() {
    host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483640; top: 0; left: 0; width: 0; height: 0;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    dragHandle = document.createElement('div');
    dragHandle.id = 'drag-handle';
    dragHandle.innerHTML = '<span class="handle-dots">●</span>';
    shadow.appendChild(dragHandle);

    panel = document.createElement('div');
    panel.id = 'panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="header" id="panel-drag-region">
        <span class="title">MufyCard 找卡助手</span>
        <div class="header-actions"><button class="export-btn" id="btn-export" type="button" title="导出角色信息">导出</button><button class="export-btn" id="btn-backup" type="button" title="完整数据备份与恢复">备份</button><button class="close" id="btn-close" type="button" aria-label="关闭">×</button></div>
      </div>
      <div class="tabs"><button class="tab-btn active" id="tab-roles" type="button">角色卡</button><button class="tab-btn" id="tab-archives" type="button">角色存档</button><button class="tab-btn" id="tab-masks" type="button">面具</button><button class="tab-btn tab-more" id="tab-more" type="button">更多</button></div>
      <div class="toolbar" id="roles-toolbar">
        <div class="scan-controls single" id="scan-controls"><button class="btn-scan" id="btn-scan">开始扫描</button><button class="btn-pause" id="btn-pause" disabled>暂停扫描</button></div><button class="btn-auth" id="btn-update-status" style="border-style:solid;background:#302a48;color:#f2efff;border-color:#6558a5">↻ 重新扫描当前账号</button>
        <button class="btn-auth" id="btn-auth">🔄 手动提取登录凭证</button>
        <div class="status" id="status-text">准备就绪</div>
        <div class="progress-wrap" aria-label="扫描进度">
          <div class="phase-label" id="phase-label">阶段 1/2 · 扫描角色页面</div>
          <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="progress-track">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
          <div class="progress-caption"><span>已加载</span><span id="progress-percent">0%</span><span>未加载</span></div>
        </div>
        <div class="report-slider" id="report-slider" aria-label="统计滑动面板">
          <section class="report-page" aria-label="基础统计">
            <div class="report" id="scan-report">
              <button class="report-item" type="button" data-role-filter="all"><span class="report-num" id="count-total">0</span><span class="report-label">角色总数</span></button>
              <button class="report-item" type="button" data-role-filter="fav"><span class="report-num" id="count-fav">0</span><span class="report-label">已收藏</span></button>
              <button class="report-item" type="button" data-role-filter="unfav"><span class="report-num" id="count-unfav">0</span><span class="report-label">未收藏</span></button>
              <button class="report-item" type="button" data-role-filter="deleted"><span class="report-num" id="count-deleted">0</span><span class="report-label">失效/删除</span></button>
              <button class="report-item" type="button" data-role-filter="unknown"><span class="report-num" id="count-unknown">0</span><span class="report-label">待确认</span></button>
              <button class="report-item" type="button" data-role-filter="authors"><span class="report-num" id="count-authors">0</span><span class="report-label">作者数量</span></button>
            </div>
          </section>
          <section class="report-page secondary" aria-label="聊天统计">
            <div class="report">
              <button class="report-item" type="button" data-role-filter="fav-unchatted"><span class="report-num" id="count-fav-unchatted">0</span><span class="report-label">收藏未聊</span></button>
              <button class="report-item" type="button" data-role-filter="fav-chatted"><span class="report-num" id="count-fav-chatted">0</span><span class="report-label">收藏已聊</span></button>
            </div>
          </section>
        </div>
        <input class="search-box" id="role-search" type="search" placeholder="搜索角色名或作者名…" aria-label="搜索角色或作者" />
        <div class="bulk-fav">
          <button id="author-folder-btn" type="button">按作者整理收藏夹</button>
        </div>
        <div class="chat-bulk"><button id="btn-chat-hi" type="button">勾选角色后发送 hi</button><button id="btn-chat-hi-stop" type="button" disabled>停止发送</button></div>
      </div>
      <div class="archive-toolbar" id="archive-toolbar" style="display:none"><input class="search-box" id="archive-search" type="search" placeholder="搜索已扫描角色…" aria-label="搜索存档角色" /><div class="status" id="archive-status">只显示已完成详情扫描的角色；可逐个读取存档</div></div>
      <div id="mask-toolbar" style="display:none;gap:6px;flex-direction:column;padding:6px 8px 2px"><input class="search-box" id="mask-search" type="search" placeholder="搜索备注、名称或描述…" /><button class="mask-add-btn" id="mask-refresh-btn" type="button">↻ 扫描/刷新网站面具</button><button class="mask-add-btn" id="mask-add-btn" type="button">＋ 新增本地面具</button><div class="mask-source-tabs"><button id="mask-view-cached" type="button">已缓存面具</button><button id="mask-view-local" class="active" type="button">本地面具</button></div><div class="status" id="mask-status">本地面具与网站缓存分开显示</div></div>
      <div id="more-page"><button class="more-entry" data-wardrobe="user">🎀 User 衣柜<small>管理用户自己的穿搭预设</small></button><button class="more-entry" data-wardrobe="char">👔 Char 衣柜<small>管理角色使用的穿搭预设</small></button><button class="more-entry" id="open-music-page">♫ 音乐播放器<small>唱片封面、播放列表与循环模式</small></button><button class="more-entry" id="open-command-page">💲指令库<small>保存、搜索并快速复制聊天指令</small></button><button class="more-entry" id="open-sticker-page">👀 小u表情包<small>分类管理、批量导入与一键复制</small></button><button class="more-entry" id="open-notes-page">📝 善用备忘录<small>自由记录、搜索与置顶</small></button><button class="more-entry" id="open-persona-page">🎭 随机人物生成器<small>以角色关系、身份与性格为主的人设灵感</small></button></div>
      <div id="wardrobe-page"></div>
      <div class="toast" id="mufy-toast" role="status" aria-live="polite"></div>
      <div class="list-container" id="list-container">
        <div style="text-align:center;color:#aaa6bb;padding:20px;font-size:12px;">点击上方按钮开始扫描</div>
      </div>
      <div class="resize-grip" id="resize-grip"></div>
    `;
    shadow.appendChild(panel);

    // Persistent audio node: wardrobe rerenders and panel/tab changes won't interrupt playback.
    wardrobeAudio = document.createElement('audio');
    wardrobeAudio.preload = 'none';
    wardrobeAudio.loop = false;
    wardrobeAudio.style.display = 'none';
    wardrobeAudio.setAttribute('aria-hidden', 'true');
    panel.appendChild(wardrobeAudio);

    listContainer = panel.querySelector('#list-container');
    resizeGrip = panel.querySelector('#resize-grip');
    statusText = panel.querySelector('#status-text');
    progressFill = panel.querySelector('#progress-fill');
    progressPercent = panel.querySelector('#progress-percent');
    phaseLabel = panel.querySelector('#phase-label');
    
    bindDragEvents();
    bindPanelDrag();
    bindResizeEvent();
    
    panel.querySelector('#btn-close').onclick = () => { panel.hidden = true; saveFloatingState(); };
    document.addEventListener('pointerdown', e => { if(panel.hidden) return; const path=e.composedPath?e.composedPath():[]; if(path.includes(panel)||path.includes(dragHandle)) return; panel.hidden=true; saveFloatingState(); }, true);
    panel.querySelector('#btn-export').onclick = showExportChooser;
    panel.querySelector('#btn-backup').onclick = showBackupChoices;
    panel.querySelector('#tab-roles').onclick = () => switchTab('roles');
    panel.querySelector('#tab-archives').onclick = () => switchTab('archives');
    panel.querySelector('#tab-masks').onclick = () => switchTab('masks');
    panel.querySelector('#tab-more').onclick = () => showMorePage();
    panel.querySelectorAll('[data-wardrobe]').forEach(b => b.onclick = () => openWardrobe(b.dataset.wardrobe));
    panel.querySelector('#open-music-page').onclick = openMusicPage;
    panel.querySelector('#open-command-page').onclick = openCommandPage;
    panel.querySelector('#open-sticker-page').onclick = openStickerPage;
    panel.querySelector('#open-notes-page').onclick = openNotesPage;
    panel.querySelector('#open-persona-page').onclick = openPersonaPage;
    panel.querySelector('#btn-scan').onclick = () => { if (scanRunning && scanPaused) setScanPaused(false); else if (!scanRunning) runScan(); };
    panel.querySelector('#btn-pause').onclick = () => { if (scanRunning && !scanPaused) setScanPaused(true); };
    panel.querySelector('#btn-update-status').onclick = () => { if (!scanRunning) runScan(true); };
    panel.querySelector('#mask-add-btn').onclick = () => renderMaskForm();
    panel.querySelector('#mask-view-local').onclick = () => setMaskView('local');
    panel.querySelector('#mask-view-cached').onclick = () => setMaskView('remote');
    panel.querySelector('#mask-refresh-btn').onclick = refreshRemoteMasks;
    panel.querySelector('#mask-search').addEventListener('input', e => { maskSearchQuery = e.target.value || ''; renderMaskPage(); });
    panel.querySelector('#author-folder-btn').onclick = () => organizeAuthorFolders();
    panel.querySelector('#btn-chat-hi').onclick = runChatHiBatch;
    panel.querySelector('#btn-chat-hi-stop').onclick = () => { chatHiStopRequested = true; updateStatus('正在停止批量打招呼…'); };
    panel.querySelector('#role-search').addEventListener('input', () => { if (activeTab === 'roles') renderFilteredRoles(); });
    panel.querySelectorAll('[data-role-filter]').forEach(item => {
      item.addEventListener('click', () => {
        activeRoleFilter = item.dataset.roleFilter || 'all';
        selectedRoleIds.clear();
        renderFilteredRoles();
        updateChatHiButtonLabel();
        panel.querySelectorAll('[data-role-filter]').forEach(node => node.classList.toggle('filter-active', node === item));
        if (activeRoleFilter === 'fav-unchatted') {
          const search = panel.querySelector('#role-search');
          if (search) search.value = '';
          renderFilteredRoles();
          showToast('已切换到「收藏未聊」列表；勾选需要打招呼的角色后再发送。');
        }
      });
    });
    panel.querySelector('#archive-search').addEventListener('input', () => { if (activeTab === 'archives') renderArchivePage(); });
    panel.querySelector('#btn-auth').onclick = () => {
        if (scanStoredAuth()) {
            updateStatus('✅ 成功提取到凭证，请点击扫描', 'ok');
        } else {
            updateStatus('❌ 缓存中没找到，请随便点开一个角色聊天', 'err');
        }
    };

    dragHandle.classList.add('is-ball');
    dragHandle.classList.remove('is-left-bar', 'is-right-bar');
    dragHandle.innerHTML = '<span class="handle-dots">●</span>';
    restoreFloatingState();
  }

  // 悬浮控件位置与面板尺寸独立持久化，不与扫描缓存相互影响。
  const FLOATING_STATE_KEY = 'mufycard_floating_state_v1';
  function readFloatingState() {
    try { return JSON.parse(W.localStorage.getItem(FLOATING_STATE_KEY) || 'null'); } catch (_) { return null; }
  }
  function saveFloatingState() {
    if (!dragHandle || !panel) return;
    const h = dragHandle.getBoundingClientRect(), p = panel.getBoundingClientRect(), prev = readFloatingState() || {};
    const state = {
      handleTop: h.top,
      handleLeft: h.left,
      handleMode: dragHandle.classList.contains('is-bar') ? 'bar' : 'ball',
      handleSide: h.left + h.width / 2 < window.innerWidth / 2 ? 'left' : 'right',
      panelTop: panel.hidden ? (Number(prev.panelTop) || window.innerHeight * 0.2) : p.top,
      panelWidth: panel.hidden ? (Number(prev.panelWidth) || p.width || 360) : p.width,
      panelHeight: panel.hidden ? (Number(prev.panelHeight) || p.height || Math.min(600, window.innerHeight * 0.72)) : p.height,
      panelOpen: !panel.hidden,
      savedAt: Date.now()
    };
    try { W.localStorage.setItem(FLOATING_STATE_KEY, JSON.stringify(state)); } catch (_) {}
    try { localStorage.setItem(FLOATING_STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function restoreFloatingState() {
    const st = readFloatingState();
    const top = Math.max(8, Math.min(window.innerHeight - 108, Number(st?.handleTop ?? window.innerHeight / 2 - 50)));
    if (st?.handleMode !== 'ball') {
      snapToEdge(st?.handleSide === 'left' ? 'left' : 'right', top, false);
    } else {
      dragHandle.classList.remove('is-bar', 'is-left-bar', 'is-right-bar'); dragHandle.classList.add('is-ball'); dragHandle.style.borderRadius = ''; dragHandle.innerHTML = '<span class="handle-dots">●</span>';
      const left = Math.max(0, Math.min(window.innerWidth - 48, Number(st?.handleLeft ?? window.innerWidth - 56)));
      dragHandle.style.left = `${left}px`; dragHandle.style.right = 'auto'; dragHandle.style.top = `${Math.max(8, Math.min(window.innerHeight - 56, top))}px`;
    }
    if (st && Number.isFinite(Number(st.panelTop))) panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 42, Number(st.panelTop)))}px`;
    if (st && Number.isFinite(Number(st.panelWidth))) panel.style.width = `${Math.max(260, Math.min(window.innerWidth - 12, Number(st.panelWidth)))}px`;
    if (st && Number.isFinite(Number(st.panelHeight))) panel.style.height = `${Math.max(300, Math.min(window.innerHeight - 16, Number(st.panelHeight)))}px`;
  }
  window.addEventListener('resize', () => {
    if (!dragHandle || !panel) return;
    const r = dragHandle.getBoundingClientRect();
    if (dragHandle.classList.contains('is-bar')) snapToEdge(r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right', r.top, false);
    else {
      dragHandle.style.left = `${Math.max(0, Math.min(window.innerWidth - dragHandle.offsetWidth, r.left))}px`;
      dragHandle.style.right = 'auto';
      dragHandle.style.top = `${Math.max(8, Math.min(window.innerHeight - dragHandle.offsetHeight - 8, r.top))}px`;
    }
    if (!panel.hidden) {
      const pr = panel.getBoundingClientRect();
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - Math.min(pr.height, window.innerHeight - 16) - 8, pr.top))}px`;
      panel.style.width = `${Math.min(pr.width, window.innerWidth - 16)}px`;
      panel.style.height = `${Math.min(pr.height, window.innerHeight - 16)}px`;
      const side = dragHandle.classList.contains('is-bar') && dragHandle.getBoundingClientRect().left < window.innerWidth / 2 ? 'left' : 'right';
      if (side === 'right') { panel.style.left = 'auto'; panel.style.right = '8px'; }
      else { panel.style.left = '32px'; panel.style.right = 'auto'; }
    }
    saveFloatingState();
  });

  function excelEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function showExportChooser() {
    const old = panel.querySelector('#export-chooser'); if (old) old.remove();
    const overlay = document.createElement('div'); overlay.id='export-chooser'; overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML = `<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center"><strong>选择导出内容</strong><button type="button" data-close>×</button></div><div style="display:grid;gap:8px;margin-top:14px"><button type="button" data-kind="roles">导出角色卡信息（Excel）</button><button type="button" data-kind="masks">导出面具信息（JSON）</button><button type="button" data-kind="wardrobe">导出衣柜（JSON）</button></div></section>`;
    panel.appendChild(overlay); overlay.querySelector('[data-close]').onclick=()=>overlay.remove(); overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelector('[data-kind="roles"]').onclick=()=>{overlay.remove();exportRolesToExcel();};
    overlay.querySelector('[data-kind="masks"]').onclick=()=>{overlay.remove();exportMaskInfo();};
    overlay.querySelector('[data-kind="wardrobe"]').onclick=()=>{overlay.remove();exportWardrobeBackup();};
  }
  function downloadJson(filename, data) {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.documentElement.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function exportMaskInfo() {
    downloadJson(`MufyCard面具信息_${new Date().toISOString().slice(0,10)}.json`, {exportedAt:new Date().toISOString(),localMasks,remoteMasks});
    showToast('已导出面具信息。','ok');
  }
  function importWardrobeBackup() {
    const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const obj=JSON.parse(await file.text());const data=obj.data||obj;if(!data.user||!data.char)throw new Error('文件不包含完整的 User/Char 衣柜');if(!confirm('导入会合并分类和预设，不会清空现有内容。继续吗？'))return;for(const type of ['user','char']){const src=data[type];wardrobeData[type].categories=[...new Set([...wardrobeData[type].categories,...(src.categories||[])])];for(const item of (src.items||[])){if(item&&item.description)wardrobeData[type].items.push({...item,id:'w'+Date.now()+Math.random().toString(16).slice(2),categories:Array.isArray(item.categories)?item.categories:(item.category?[item.category]:[])});}}if(await saveWardrobe())showToast('衣柜备份已导入。','ok');}catch(e){showToast('导入失败：备份文件格式不正确。','err');}};input.click();
  }
  function exportWardrobeBackup() {
    downloadJson(`MufyCard衣柜备份_${new Date().toISOString().slice(0,10)}.json`, {schema:2,exportedAt:new Date().toISOString(),data:wardrobeData});
    showToast('已导出 User 与 Char 衣柜备份。','ok');
  }
  function exportRolesToExcel() {
    if (!scannedRoles.length) { showToast('当前没有可导出的扫描结果。', 'err'); return; }
    const count = scannedRoles.length;
    const ok = window.confirm(`导出角色卡信息\n\n当前扫描结果共 ${count} 条角色记录。\n将包含正常角色、已失效链接，以及已确认下架但无法读取名称的角色。\n\n表格列：角色卡名称、是否已收藏、链接是否正常。\n\n确认后将下载 Excel 可打开的 .xls 文件。`);
    if (!ok) return;
    const rows = [['角色卡名称','是否已收藏','链接是否正常']];
    for (const role of scannedRoles) {
      const deleted = roleIsDeleted(role) && !String(role.name || '').trim();
      const name = deleted ? '已下架角色' : (String(role.name || '').trim() || '未知角色');
      const fav = deleted ? '无' : (typeof role.isFav === 'boolean' ? (role.isFav ? '是' : '否') : '无');
      const link = deleted ? '无' : (role.linkStatus === 'deleted' || role.linkStatus === 'invalid' || role.linkStatus === 'expired' ? '已失效' : role.linkStatus === 'active' ? '正常' : '无法确认');
      rows.push([name, fav, link]);
    }
    const table = `<table border="1"><thead><tr>${rows[0].map(v=>`<th>${excelEscape(v)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(v=>`<td>${excelEscape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `MufyCard角色信息_${new Date().toISOString().slice(0,10)}.xls`;
    document.documentElement.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`已导出 ${count} 条角色记录。`, 'ok');
  }

  // ================= 4. 拖拽与缩放逻辑 =================
  let dragState = { isDragging: false, startX: 0, startY: 0, initX: 0, initY: 0 };

  function bindDragEvents() {
    dragHandle.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { dragHandle.setPointerCapture(e.pointerId); } catch (_) {}
      const rect = dragHandle.getBoundingClientRect();
      dragState = { isDragging: true, startX: e.clientX, startY: e.clientY, initX: rect.left, initY: rect.top, moved: false };
    });
    dragHandle.addEventListener('pointermove', e => {
      if (!dragState.isDragging) return;
      const dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        dragState.moved = true;
        dragHandle.classList.remove('is-bar');
        dragHandle.classList.add('is-ball');
        dragHandle.style.borderRadius = '';
        dragHandle.innerHTML = '<span class="handle-dots">●</span>';
      }
      if (dragState.moved) {
        const x = Math.max(0, Math.min(window.innerWidth - 48, dragState.initX + dx));
        const y = Math.max(0, Math.min(window.innerHeight - 48, dragState.initY + dy));
        dragHandle.style.left = `${x}px`; dragHandle.style.right = 'auto'; dragHandle.style.top = `${y}px`; dragHandle.style.bottom = 'auto';
      }
    });
    const finishDrag = e => {
      if (!dragState.isDragging) return;
      dragState.isDragging = false;
      try { dragHandle.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!dragState.moved) {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          const r = dragHandle.getBoundingClientRect();
          const onRight = r.left + r.width / 2 >= window.innerWidth / 2;
          const width = Math.min(panel.getBoundingClientRect().width || 400, window.innerWidth - 16);
          panel.style.width = `${width}px`;
          panel.style.left = onRight ? 'auto' : '8px';
          panel.style.right = onRight ? '8px' : 'auto';
          panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 42, Number(readFloatingState()?.panelTop ?? r.top - 100)))}px`;
          panel.style.bottom = 'auto';
        }
        saveFloatingState();
        return;
      }
      const rect = dragHandle.getBoundingClientRect(), winW = window.innerWidth;
      if (rect.left < 40) snapToEdge('left', rect.top, true);
      else if (winW - rect.right < 40) snapToEdge('right', rect.top, true);
      else {
        dragHandle.classList.remove('is-bar', 'is-left-bar', 'is-right-bar'); dragHandle.classList.add('is-ball'); dragHandle.style.borderRadius = ''; dragHandle.innerHTML = '<span class="handle-dots">●</span>';
        dragHandle.style.left = `${Math.max(0, Math.min(winW - 48, rect.left))}px`;
        dragHandle.style.right = 'auto'; dragHandle.style.top = `${Math.max(8, Math.min(window.innerHeight - 56, rect.top))}px`;
      }
      saveFloatingState();
    };
    dragHandle.addEventListener('pointerup', finishDrag);
    dragHandle.addEventListener('pointercancel', e => { dragState.isDragging = false; try { dragHandle.releasePointerCapture(e.pointerId); } catch (_) {} });
  }

  function snapToEdge(side, top = window.innerHeight / 2 - 50, persist = true) {
    dragHandle.classList.remove('is-ball', 'is-left-bar', 'is-right-bar'); dragHandle.classList.add('is-bar', side === 'left' ? 'is-left-bar' : 'is-right-bar'); dragHandle.innerHTML = '<span class="handle-dots">⋮</span>';
    dragHandle.style.top = `${Math.max(8, Math.min(window.innerHeight - 108, Number(top) || 8))}px`;
    dragHandle.style.bottom = 'auto';
    if (side === 'left') {
      dragHandle.style.left = '-16px'; dragHandle.style.right = 'auto'; dragHandle.style.borderRadius = '0 16px 16px 0';
    } else {
      dragHandle.style.left = 'auto'; dragHandle.style.right = '-16px'; dragHandle.style.borderRadius = '16px 0 0 16px';
    }
    if (persist) saveFloatingState();
  }

  function bindPanelDrag() {
    const header = panel.querySelector('#panel-drag-region');
    let pDrag = { isDragging: false, startX: 0, startY: 0, initX: 0, initY: 0 };
    header.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      pDrag.isDragging = true;
      pDrag.startX = e.clientX;
      pDrag.startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      pDrag.initX = rect.left;
      pDrag.initY = rect.top;
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', e => {
      if (!pDrag.isDragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, pDrag.initX + (e.clientX - pDrag.startX)));
      const y = Math.max(0, Math.min(window.innerHeight - 42, pDrag.initY + (e.clientY - pDrag.startY))); // 允许面板下半部分出屏，但标题栏始终可见
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    header.addEventListener('pointerup', e => {
      pDrag.isDragging = false;
      try { header.releasePointerCapture(e.pointerId); } catch (_) {}
      const r = panel.getBoundingClientRect(); panel.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, r.left))}px`; panel.style.right = 'auto'; panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 42, r.top))}px`; saveFloatingState();
    });
  }

  function bindResizeEvent() {
    let rs = { isDragging: false, startX: 0, startY: 0, initW: 0, initH: 0, initLeft: 0, initTop: 0 };
    resizeGrip.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { resizeGrip.setPointerCapture(e.pointerId); } catch (_) {}
      const rect = panel.getBoundingClientRect();
      rs = { isDragging: true, startX: e.clientX, startY: e.clientY, initW: rect.width, initH: rect.height, initLeft: rect.left, initTop: rect.top };
    });
    resizeGrip.addEventListener('pointermove', e => {
      if (!rs.isDragging) return;
      const dx = e.clientX - rs.startX;
      const dy = e.clientY - rs.startY;
      // Grip is bottom-right: drag right/down to grow, left/up to shrink.
      const w = Math.max(260, Math.min(window.innerWidth - 8, rs.initW + dx));
      const h = Math.max(300, Math.min(window.innerHeight - 16, rs.initH + dy));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      panel.style.maxHeight = 'none';
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, rs.initTop))}px`;
      panel.style.bottom = 'auto';
      panel.style.left = 'auto';
      panel.style.right = `${Math.max(0, window.innerWidth - rs.initLeft - w)}px`;
    });
    const endResize = e => {
      if (!rs.isDragging) return;
      rs.isDragging = false;
      try { resizeGrip.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    resizeGrip.addEventListener('pointerup', e => { endResize(e); saveFloatingState(); });
    resizeGrip.addEventListener('pointercancel', endResize);
  }

  function updateProgress(value) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
    const track = panel?.querySelector('#progress-track');
    if (track) track.setAttribute('aria-valuenow', String(pct));
  }

  function setPhase(label, value = 0) {
    if (phaseLabel) phaseLabel.textContent = label;
    updateProgress(value);
  }

  // 仅在用户主动启动的扫描真正完成时提示；不保存待提示状态，不在页面启动/刷新时重播。
  function notifyScanComplete(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    window.alert(`MufyCard 找卡助手扫描完成！共扫描 ${safeCount} 个角色。`);
  }


  // ================= 5. 核心扫描逻辑 =================
  async function clearScanResults() {
    if (!window.confirm('确定清空本次扫描结果和扫描进度吗？此操作不会删除角色存档、本地面具或网站数据。')) return;
    // 即使正在扫描也允许清空；先请求当前扫描循环停止，避免旧请求完成后把数据写回来。
    if (scanRunning) { scanCancelRequested = true; scanPaused = false; pauseWaiters.splice(0).forEach(resolve => resolve()); }
    scanCacheEpoch += 1;
    try { await scanCacheWriteQueue; } catch (_) {}
    scannedRoles = [];
    selectedRoleIds.clear();
    activeRoleFilter = 'all';
    persistentRemove(SCAN_CACHE_KEY);
    persistentRemove(SCAN_CACHE_STABLE_KEY);
    clearResumeState();
    const main = panel.querySelector('#btn-scan');
    const pause = panel.querySelector('#btn-pause');
    const controls = panel.querySelector('#scan-controls');
    if (main) { main.textContent = '开始扫描'; main.disabled = false; }
    if (pause) { pause.textContent = '暂停扫描'; pause.disabled = true; }
    if (controls) { controls.classList.remove('running'); controls.classList.add('single'); }
    panel.querySelectorAll('[data-role-filter]').forEach(node => node.classList.toggle('filter-active', node.dataset.roleFilter === 'all'));
    const search = panel.querySelector('#role-search'); if (search) search.value = '';
    renderFilteredRoles();
    updateReport();
    populateAuthorSelect();
    setPhase('阶段 1/2 · 扫描角色页面', 0);
    updateStatus('扫描结果已清空，可以重新开始扫描。', 'ok');
    showToast('已清空扫描结果；角色存档和面具未受影响。');
  }

  async function runScan(updateOnly = false) {
    // “重新扫描当前账号”不再做增量合并：先丢弃旧账号的角色列表与扫描进度，再完整读取当前登录账号。
    const forceFreshScan = Boolean(updateOnly);
    updateOnly = false;
    scanMode = 'full';
    scanCancelRequested = false;
    const btn = panel.querySelector('#btn-scan');
    if (scanRunning) return;
    scanStoredAuth();
    if (!authToken) {
      updateStatus('❌ 抓不到登录状态，请点击“手动提取”或先打开一个角色聊天页', 'err');
      return;
    }
    if (forceFreshScan) {
      scanCacheEpoch += 1;
      try { await scanCacheWriteQueue; } catch (_) {}
      scannedRoles = [];
      selectedRoleIds.clear();
      activeRoleFilter = 'all';
      persistentRemove(SCAN_CACHE_KEY);
      persistentRemove(SCAN_CACHE_STABLE_KEY);
      clearResumeState();
      renderFilteredRoles();
      updateReport();
      populateAuthorSelect();
      setPhase('阶段 1/2 · 重新扫描当前账号', 0);
      updateStatus('已移除上次扫描列表，正在从头扫描当前登录账号…');
    }
    const previousScannedIds = new Set();
    const savedResume = forceFreshScan ? null : await loadResumeState();
    scanRunning = true;
    scanPaused = false;
    pauseWaiters = [];
    btn.disabled = true;
    btn.textContent = updateOnly ? '正在更新…' : '正在扫描…';
    panel.querySelector('#btn-update-status').disabled = true;
    const pauseBtn = panel.querySelector('#btn-pause');
    const controls = panel.querySelector('#scan-controls');
    controls.classList.add('running'); controls.classList.remove('single');
    pauseBtn.disabled = false;
    pauseBtn.textContent = '暂停扫描';
    const hasRecoverableState = Boolean(savedResume || scannedRoles.length);
    if (!hasRecoverableState) updateProgress(0);
    // 不再请求通知权限，也不弹权限确认框；点击扫描后直接开始。
    // 页面切到后台时会尽力继续运行，但浏览器/系统仍可能暂停网页脚本。
    listContainer.innerHTML = '';
    if (!savedResume || savedResume.phase !== 'details') saveResumeState({ phase: 'list' });

    // 与 MufyLink 的分页思路一致：优先读取分页元数据，并兼容多种列表包装结构。
    function extractRows(data, depth = 0) {
      if (Array.isArray(data)) return data;
      if (!data || typeof data !== 'object' || depth > 5) return [];
      for (const key of ['list', 'rows', 'records', 'items', 'content', 'results']) {
        if (Array.isArray(data[key])) return data[key];
      }
      for (const key of ['data', 'result', 'page', 'records']) {
        const nested = data[key];
        if (nested && typeof nested === 'object') {
          const rows = extractRows(nested, depth + 1);
          if (rows.length) return rows;
        }
      }
      return [];
    }

    function hasMorePages(data, rows, page, pageSize) {
      const sources = [data, data?.data, data?.result, data?.pagination,
        data?.data?.pagination, data?.result?.pagination]
        .filter(x => x && typeof x === 'object' && !Array.isArray(x));
      const readNum = keys => {
        for (const src of sources) for (const key of keys) {
          if (src[key] !== undefined && src[key] !== null && src[key] !== '') {
            const n = Number(src[key]);
            if (Number.isFinite(n)) return n;
          }
        }
        return NaN;
      };
      const totalPages = readNum(['totalPages', 'pageCount', 'pages']);
      if (Number.isFinite(totalPages) && totalPages > 0) return page < totalPages;
      const total = readNum(['total', 'totalCount', 'count']);
      if (Number.isFinite(total) && total >= 0) return page * pageSize < total;
      for (const src of sources) {
        if (typeof src.hasMore === 'boolean') return src.hasMore;
        if (typeof src.hasNext === 'boolean') return src.hasNext;
      }
      return rows.length >= pageSize;
    }

    // 只使用接口实际返回的角色 URL，避免猜测路由造成跳转错误。
    function extractRoleUrl(root) {
      if (!root || typeof root !== 'object') return '';
      const keys = ['url', 'href', 'link', 'characterUrl', 'shareUrl', 'detailUrl', 'webUrl'];
      for (const key of keys) {
        const value = root[key];
        if (typeof value === 'string' && value.trim()) {
          try {
            const u = new URL(value.trim(), location.origin);
            if (u.origin === location.origin && /^https?:$/.test(u.protocol)) return u.href;
          } catch (_) {}
        }
      }
      return '';
    }

    // 作者字段严格按 MufyLink 的 normalize/authorNameFrom 方式解析；不把角色自身的 name 当成作者名。
    function extractAuthorInfo(root) {
      if (!root || typeof root !== 'object') return { name: '', id: '' };
      const explicitNameKeys = ['authorName', 'creatorName', 'userName', 'ownerName', 'createdByName', 'createdByNickname', 'authorNickname', 'authorNickName', 'creatorNickname', 'creatorNickName', 'creatorUsername'];
      const idKeys = ['authorId', 'creatorId', 'userId', 'ownerId', 'author_id', 'creator_id', 'user_id'];
      const nameFrom = obj => {
        if (typeof obj === 'string') return obj.trim();
        if (!obj || typeof obj !== 'object') return '';
        return String(obj.name || obj.nickname || obj.nickName || obj.username || obj.displayName || obj.userName || obj.userNickname || obj.userNickName || obj.profile?.name || obj.profile?.nickname || obj.userInfo?.name || obj.userInfo?.nickname || obj.userInfo?.nickName || '').trim();
      };
      const roots = [root, root.character, root.characterInfo, root.characterData, root.role].filter(v => v && typeof v === 'object');
      for (const obj of roots) {
        for (const key of explicitNameKeys) if (typeof obj[key] === 'string' && obj[key].trim()) return { name: obj[key].trim(), id: String(idKeys.map(k => obj[k]).find(v => v != null && String(v).trim()) || '') };
        const author = obj.author || obj.authorInfo || obj.creator || obj.creatorInfo || obj.user || obj.userInfo || obj.owner || obj.createdBy || obj.createdByUser || obj.profile;
        const name = nameFrom(author);
        if (name) {
          const id = author && typeof author === 'object' ? (author.id ?? author.userId ?? author.user_id ?? author.authorId ?? author.creatorId ?? '') : '';
          return { name, id: String(id || '') };
        }
      }
      return { name: '', id: String(idKeys.map(k => roots.map(obj => obj[k]).find(v => v != null && String(v).trim())).find(v => v != null) || '') };
    }

    function getRoleSessionId(row, character) {
      const candidates = [row?.lastSessionId, row?.sessionId, row?.sourceSessionId, row?.last_session_id, row?.session?.id, row?.lastSession?.id, character?.lastSessionId, character?.sessionId];
      const found = candidates.find(value => value != null && String(value).trim());
      return found == null ? '' : String(found);
    }

    async function fetchAllPages(isFollowed, label) {
      const found = new Map();
      const seenPageSignatures = new Set();
      const pageSize = 20;
      const maxPages = 500;
      for (let page = 1; page <= maxPages; page++) {
        if (scanCancelRequested) return found;
        await waitIfPaused();
        updateStatus(`正在读取${label}第 ${page} 页，已找到 ${found.size} 个…`);
        pageProgressTicks += 1;
        // 总页数未知时用渐近进度显示；真正结束分页后再补到 100%。
        setPhase('阶段 1/2 · 扫描角色页面', Math.min(95, 2 + pageProgressTicks * 1.4));
        const url = `/api/characters/query_session?pageNum=${page}&pageSize=${pageSize}&isFollowed=${isFollowed}`;
        await waitIfPaused();
        const data = await apiRequest(url);
        await waitIfPaused();
        const rows = extractRows(data);
        if (!rows.length) break;

        const normalizedIds = [];
        for (const row of rows) {
          const c = row?.character || row;
          const rawId = c?.id ?? c?.characterId ?? row?.characterId;
          if (rawId === undefined || rawId === null || String(rawId) === '') continue;
          const id = String(rawId);
          normalizedIds.push(id);
          const existing = found.get(id);
          const role = {
            id,
            name: c?.name || c?.characterName || '未命名',
            url: extractRoleUrl(c) || extractRoleUrl(row),
            authorName: extractAuthorInfo(c).name || extractAuthorInfo(row).name || '未知作者',
            authorId: extractAuthorInfo(c).id || extractAuthorInfo(row).id || '',
            isFav: Boolean(isFollowed === 'true' || row?.isFollowed || row?.isFavorite),
            lastSessionId: getRoleSessionId(row, c),
            hasChatHistory: Boolean(getRoleSessionId(row, c)),
            maskId: null,
            maskName: '无面具',
            linkStatus: 'unknown'
          };
          if (!existing) found.set(id, role);
          else {
            if (role.isFav) existing.isFav = true;
            if (role.hasChatHistory) existing.hasChatHistory = true;
            if (role.lastSessionId) existing.lastSessionId = role.lastSessionId;
          }
        }

        const signature = normalizedIds.join('|');
        if (seenPageSignatures.has(signature)) break;
        seenPageSignatures.add(signature);
        if (rows.length < pageSize || !hasMorePages(data, rows, page, pageSize)) break;
        await sleep(200);
      }
      return [...found.values()];
    }

    let pageProgressTicks = 0;
    try {
      let roles = [];
      let startDetailIndex = 0;
      if (savedResume?.phase === 'details' && Array.isArray(savedResume.roles) && savedResume.roles.length) {
        roles = savedResume.roles;
        scannedRoles = roles;
        // 以每个角色持久化的完成标记为准，避免 nextIndex 与缓存写入时机不同步造成跳过或回退。
        const firstPending = roles.findIndex(role => !role?._detailScanned);
        // 角色完成标记随扫描结果一起写入缓存，比进度游标更能反映请求中断时的真实状态。
        startDetailIndex = firstPending >= 0 ? firstPending : roles.length;
        updateStatus(startDetailIndex < roles.length
          ? `已恢复未完成扫描：继续解析第 ${startDetailIndex + 1}/${roles.length} 个角色…`
          : `已恢复扫描记录：${roles.length} 个角色的详情均已完成，正在收尾…`);
        setPhase('阶段 2/2 · 恢复详情扫描', roles.length ? roles.filter(role => role?._detailScanned).length / roles.length * 100 : 100);
        renderActiveTab(); updateReport();
      } else if (!updateOnly && savedResume?.phase === 'list' && scannedRoles.length) {
        // 页面刷新/跳转时可能留下 phase=list 标记，但角色列表已经缓存在本版本。
        // 直接从缓存角色中找第一个未完成详情的角色，不要重新抓列表或把进度清零。
        roles = scannedRoles;
        const firstPending = roles.findIndex(role => !role?._detailScanned);
        startDetailIndex = firstPending < 0 ? roles.length : firstPending;
        saveResumeState({ phase: 'details', roles, nextIndex: startDetailIndex });
        updateStatus(startDetailIndex < roles.length
          ? `已从本版本缓存恢复：继续解析第 ${startDetailIndex + 1}/${roles.length} 个角色…`
          : `本版本缓存中的 ${roles.length} 个角色详情均已完成，正在恢复扫描状态…`);
        setPhase('阶段 2/2 · 从缓存恢复详情扫描', roles.length ? roles.filter(role => role?._detailScanned).length / roles.length * 100 : 100);
        renderActiveTab(); updateReport();
      } else {
        updateStatus('正在分页读取会话与收藏列表…');
        setPhase('阶段 1/2 · 扫描角色页面', 0);
        const [chatList, favList] = await Promise.all([
          fetchAllPages('false', '会话'),
          fetchAllPages('true', '收藏')
        ]);
        const roleMap = new Map();
        for (const role of [...chatList, ...favList]) {
          const old = roleMap.get(role.id);
          if (!old) roleMap.set(role.id, role);
          else {
            if (role.isFav) old.isFav = true;
            if (role.hasChatHistory) old.hasChatHistory = true;
            if (role.lastSessionId) old.lastSessionId = role.lastSessionId;
          }
        }
        const fetchedRoles = [...roleMap.values()];
        // 收藏列表有时不返回 lastSessionId；保留同一角色已有缓存中的聊天记录，避免被误判为“收藏未聊”。
        const priorById = new Map(scannedRoles.map(role => [String(role.id), role]));
        for (const fresh of fetchedRoles) {
          const prior = priorById.get(String(fresh.id));
          const cachedArchives = archiveCache.get(String(fresh.id));
          if ((Array.isArray(cachedArchives) && cachedArchives.length > 0) || (prior && roleHasChatHistory(prior))) fresh.hasChatHistory = true;
          if (prior && !fresh.lastSessionId && prior.lastSessionId) fresh.lastSessionId = prior.lastSessionId;
        }
        if (!updateOnly) {
          updateStatus('正在核对收藏夹中缺失的角色（用于补充已删除卡）…');
          const deletedFolderRoles = await discoverDeletedCardsFromFolders(fetchedRoles);
          for (const deletedRole of deletedFolderRoles) {
            if (!roleMap.has(String(deletedRole.id))) { roleMap.set(String(deletedRole.id), deletedRole); fetchedRoles.push(deletedRole); }
          }
        }
        if (updateOnly && scannedRoles.length) {
          const oldById = new Map(scannedRoles.map(r => [String(r.id), r]));
          let added = 0;
          for (const fresh of fetchedRoles) {
            const old = oldById.get(String(fresh.id));
            if (old) { old.isFav = Boolean(old.isFav || fresh.isFav); old.url = fresh.url || old.url; if ((!old.authorName || old.authorName === '未知作者') && fresh.authorName) old.authorName = fresh.authorName; }
            else { oldById.set(String(fresh.id), fresh); added++; }
          }
          roles = [...oldById.values()];
          scannedRoles = roles;
          updateStatus(`更新列表完成：新增 ${added} 个角色，已存在角色跳过详情扫描。`);
        } else { roles = fetchedRoles; scannedRoles = roles; }
        saveScanCache();
        updateReport();
        renderActiveTab();
        if (!roles.length) throw new Error('列表为空：接口没有返回角色，或当前登录状态无权访问。');
        setPhase('阶段 1/2 · 角色页面扫描完成', 100);
        updateStatus(`页面扫描完成，找到 ${roles.length} 个角色；准备逐个读取详情…`);
        await sleep(300);
      }
      const rolesToDetail = updateOnly ? roles.filter(r => !previousScannedIds.has(String(r.id))) : roles;
      // 用标记区分已完成详情的缓存角色；新发现角色才进入详情扫描。
      const detailRoles = (updateOnly ? rolesToDetail : roles.slice(startDetailIndex)).filter(role => !role?._detailScanned);
      saveResumeState({ phase: 'details', roles, nextIndex: startDetailIndex });
      setPhase('阶段 2/2 · 逐个解析角色详情', roles.length ? roles.filter(role => role?._detailScanned).length / roles.length * 100 : 100);
      updateStatus(`已获取 ${roles.length} 个角色，准备读取面具库…`);
      const maskMap = new Map();
      try {
        // 面具库可能分页；读取多页并兼容常见名称字段，避免只显示面具 ID。
        const pageSize = 100;
        for (let page = 1; page <= 20; page++) {
          const maskData = await apiRequest('/api/masks/query', 'POST', { page, pageNum: page, pageSize });
          const masks = extractRows(maskData);
          for (const m of masks) {
            const ids = [m.maskId, m.id, m.mask_id].filter(v => v !== undefined && v !== null).map(String);
            const name = [m.maskName, m.name, m.remark, m.title, m.displayName, m.mask_name, m.label]
              .find(v => typeof v === 'string' && v.trim());
            if (name) ids.forEach(id => maskMap.set(id, name.trim()));
          }
          // 保存网站面具的完整字段；不触碰本地新增面具。
          if (page === 1) remoteMasks = [];
          remoteMasks.push(...masks.map(m => ({
            source: 'remote', maskId: String(m.maskId ?? m.id ?? m.mask_id ?? ''),
            maskName: String(m.maskName ?? m.name ?? ''), gender: String(m.gender ?? ''),
            description: String(m.description ?? ''), favorite: String(m.favorite ?? ''),
            command: String(m.command ?? ''), remark: String(m.remark ?? ''), createdAt: String(m.createdAt ?? '')
          })).filter(m => m.maskId));
          if (masks.length < pageSize || !hasMorePages(maskData, masks, page, pageSize)) break;
        }
        saveRemoteMasks();
        if (activeTab === 'masks') renderMaskPage();
      } catch (e) {
        console.warn('[MufyCard 找卡助手 3.3.7 预览版 6.6] 面具名称读取失败，继续扫描角色。', e);
      }

      for (let i = 0; i < detailRoles.length; i++) {
        if (scanCancelRequested) break;
        await waitIfPaused();
        const role = detailRoles[i];
        saveResumeState({ phase: 'details', roles, nextIndex: i, total: roles.length, completed: roles.filter(item => item?._detailScanned).length });
        try {
          await waitIfPaused();
          let detailData;
          let detailError;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              detailData = await apiRequest(`/api/characters/get?id=${encodeURIComponent(role.id)}`);
              detailError = null;
              break;
            } catch (err) {
              detailError = err;
              const em = String(err?.message || err);
              const terminal = /HTTP 404|HTTP 410|code=404|code=410|not found|角色详情不存在|角色不存在|链接已失效|链接失效|已删除|已下架|deleted|expired/i.test(em);
              if (terminal || attempt === 2) throw err;
              await sleep(350 * (attempt + 1));
            }
          }
          if (detailError) throw detailError;
          await waitIfPaused();
          const d = detailData?.data?.data || detailData?.data || detailData?.character || detailData;
          const detailLooksLikeCharacter = Boolean(d && typeof d === 'object' && !Array.isArray(d) &&
            (d.id || d.characterId || d.name || d.characterName || d.authorId || d.authorName));
          const statusText = String(d?.status ?? d?.linkStatus ?? d?.state ?? '').toLowerCase();
          const detailExplicitlyDeleted = d?.isDeleted === true || d?.deleted === true || d?.isAvailable === false || d?.available === false ||
            /^(deleted|removed|expired|offline|unavailable|disabled|下架|已下架|已删除|失效)$/.test(statusText);
          if (!detailLooksLikeCharacter || detailExplicitlyDeleted) {
            role.linkStatus = 'deleted';
          } else {
            role.linkStatus = 'active';
          }
          const authorInfo = extractAuthorInfo(d);
          if (authorInfo.name && authorInfo.name !== role.name) role.authorName = authorInfo.name;
          if (authorInfo.id) role.authorId = authorInfo.id;
          // 按 MufyLink 的实际补全方式：作者只有 ID 时，调用 /api/users/profiles?userId=...
          if ((!role.authorName || role.authorName === '未知作者' || role.authorName === role.name) && role.authorId) {
            try {
              const profileData = await apiRequest(`/api/users/profiles?userId=${encodeURIComponent(role.authorId)}`);
              const profile = profileData?.data?.data || profileData?.data || profileData?.profile || profileData;
              const profileName = [profile?.username, profile?.nickname, profile?.nickName, profile?.name, profile?.displayName]
                .find(v => typeof v === 'string' && v.trim());
              if (profileName && profileName.trim() !== role.name) role.authorName = profileName.trim();
            } catch (profileError) {
              console.debug('[MufyCard 找卡助手 3.3.7 预览版 6.6] 作者资料读取失败：', role.authorId, profileError);
            }
          }
          if (role.authorName === role.name) role.authorName = '未知作者';
          const maskId = d?.defaultMaskId ?? d?.maskId ?? d?.default_mask_id;
          if (maskId != null) {
            role.maskId = String(maskId);
            role.maskName = maskMap.get(role.maskId) || d?.defaultMaskName || d?.maskName || d?.mask?.name || `面具ID:${role.maskId}`;
          }
        } catch (e) {
          // 404/410 明确表示链接不存在；500 只有错误正文明确表示角色不存在/已删除/链接失效时才归为失效。
          const msg = String(e?.message || e);
          const explicitMissing = /HTTP 404|HTTP 410|code=404|code=410|not found|角色详情不存在|角色不存在|链接已失效|链接失效|已删除|已下架|deleted|expired/i.test(msg);
          role.linkStatus = explicitMissing ? 'deleted' : 'unknown';
          role.detailError = role.linkStatus === 'unknown' ? msg.slice(0, 220) : '';
        }
        role._detailScanned = true;
        saveScanCache();
        saveResumeState({ phase: 'details', roles, nextIndex: i + 1, total: roles.length, completed: roles.filter(item => item?._detailScanned).length });
        renderActiveTab();
        updateReport();
        populateAuthorSelect();
        const completedDetails = roles.filter(item => item?._detailScanned).length;
        const detailPct = roles.length ? (completedDetails / roles.length) * 100 : 100;
        setPhase('阶段 2/2 · 逐个解析角色详情', detailPct);
        updateStatus(`解析角色详情 ${completedDetails}/${roles.length}（${Math.floor(detailPct)}%）`);
        // 不再额外等待 120ms；详情接口响应后立即进入下一条，减少纯等待时间。
      }

      if (scanCancelRequested) return;
      await saveScanCache();
      clearResumeState();
      populateAuthorSelect();
      setPhase('阶段 2/2 · 扫描完成', 100);
      updateStatus(updateOnly ? `✅ 更新完成：当前共 ${roles.length} 个角色，本次新增详情 ${detailRoles.length} 个` : `✅ 扫描完成，共 ${roles.length} 个角色`, 'ok');
      // 无论是否允许通知，都完成扫描；若在后台完成，则记录状态，切回页面时提示。
      notifyScanComplete(roles.length);
    } catch (e) {
      if (scanCancelRequested) return;
      console.error('[MufyCard 找卡助手 3.3.7 预览版 6.6] 扫描失败：', e);
      updateStatus(`❌ 扫描失败：${e.message || e}`, 'err');
      window.alert(`扫描失败：${e.message || e}`);
    } finally {
      scanRunning = false;
      scanPaused = false;
      scanCancelRequested = false;
      pauseWaiters.splice(0).forEach(resolve => resolve());
      btn.disabled = false;
      btn.textContent = '开始扫描';
      panel.querySelector('#btn-update-status').disabled = false;
      pauseBtn.disabled = true;
      pauseBtn.textContent = '暂停扫描';
      const controls = panel.querySelector('#scan-controls');
      controls.classList.remove('running'); controls.classList.add('single');
    }
  }

    function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function switchTab(tab) {
    activeTab = tab;
    panel.querySelector('#roles-toolbar').style.display = tab === 'roles' ? 'flex' : 'none';
    panel.querySelector('#archive-toolbar').style.display = tab === 'archives' ? 'flex' : 'none';
    panel.querySelector('#mask-toolbar').style.display = tab === 'masks' ? 'flex' : 'none';
    panel.querySelector('#list-container').style.display = 'block';
    panel.querySelector('#tab-roles').classList.toggle('active', tab === 'roles');
    panel.querySelector('#tab-archives').classList.toggle('active', tab === 'archives');
    panel.querySelector('#tab-masks').classList.toggle('active', tab === 'masks');
    panel.querySelector('#tab-more').classList.toggle('active', false);
    panel.querySelector('#more-page').classList.remove('active'); panel.querySelector('#wardrobe-page').classList.remove('active');
    panel.querySelector('#roles-toolbar').style.display = tab === 'roles' ? 'flex' : 'none';
    panel.querySelector('#archive-toolbar').style.display = tab === 'archives' ? 'flex' : 'none';
    panel.querySelector('#mask-toolbar').style.display = tab === 'masks' ? 'flex' : 'none';
    if (tab === 'roles') renderFilteredRoles();
    else if (tab === 'archives') renderArchivePage();
    else renderMaskPage();
  }

  const WARDROBE_KEY = 'mufycard_wardrobe_v1';
  const WARDROBE_DB = 'mufycard_wardrobe_db_v1';
  let wardrobeType = 'user';
  let wardrobeCategory = '全部';
  let wardrobeView = 'more';
  let wardrobeMultiSelect = false;
  let wardrobeSelectedIds = new Set();
  let wardrobeAudio = null;
  let wardrobeAudioObjectUrl = '';
  const WARDROBE_MUSIC_URL_KEY = 'mufycard_wardrobe_music_url_v1';
  const MUSIC_TRACKS_KEY = 'mufycard_music_tracks_v1';
  const MUSIC_STATE_KEY = 'mufycard_music_state_v1';
  const MUSIC_COVER_KEY = 'mufycard_music_cover_v1';
  // 可在脚本中预置歌曲：{title:'歌曲名', url:'https://.../song.mp3', cover:''}
  const PRESET_MUSIC_TRACKS = [];
  let musicTracks = []; let musicIndex = 0; let musicMode = 'sequence'; let musicCover = ''; let musicSeekTimer = 0; let musicRestoreTime = 0; let musicRestorePending = false; let musicSeeking = false;
  const emptyWardrobe = () => ({ user: { categories: ['韩系','日系'], items: [] }, char: { categories: ['韩系','日系'], items: [] } });
  function openWardrobeDB() { return new Promise((resolve,reject)=>{ if(!W.indexedDB){reject(new Error('IndexedDB 不可用'));return;} const req=W.indexedDB.open(WARDROBE_DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('data'))req.result.createObjectStore('data');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); }); }
  async function readWardrobeDB() { const db=await openWardrobeDB(); return new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly');const req=tx.objectStore('data').get('wardrobe');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();}); }
  async function writeWardrobeDB(value) { const db=await openWardrobeDB(); return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put(value,'wardrobe');tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>{const err=tx.error;db.close();reject(err);};tx.onabort=()=>{const err=tx.error;db.close();reject(err||new Error('事务中断'));};}); }
  function readWardrobe() { try { const v=JSON.parse(W.localStorage.getItem(WARDROBE_KEY)||'null'); if(v&&v.user&&v.char)return normalizeWardrobe(v); } catch(_) {} return emptyWardrobe(); }
  function normalizeWardrobe(v) { const base=emptyWardrobe(); for(const type of ['user','char']){const g=v?.[type];if(!g)continue;base[type].categories=[...new Set((Array.isArray(g.categories)?g.categories:[]).filter(x=>typeof x==='string'&&x.trim()))];base[type].items=(Array.isArray(g.items)?g.items:[]).filter(i=>i&&typeof i.description==='string').map(i=>({...i,id:i.id||('w'+Date.now()+Math.random().toString(16).slice(2)),description:String(i.description),categories:Array.isArray(i.categories)?i.categories:(i.category?[i.category]:[]),image:String(i.image||'')}));}return base; }
  let wardrobeData = readWardrobe();
  async function initializeWardrobeStorage() { try { const saved=await readWardrobeDB(); if(saved) wardrobeData=normalizeWardrobe(saved); else { await writeWardrobeDB(wardrobeData); } } catch(e) { console.warn('[MufyCard] IndexedDB wardrobe init failed',e); } }
  void initializeWardrobeStorage();
  async function saveWardrobe() {
    try { await writeWardrobeDB(wardrobeData); try { W.localStorage.setItem(WARDROBE_KEY, JSON.stringify({...wardrobeData,user:{...wardrobeData.user,items:wardrobeData.user.items.map(i=>({...i,image:''}))},char:{...wardrobeData.char,items:wardrobeData.char.items.map(i=>({...i,image:''}))}})); } catch(_) {} showToast('衣柜已保存到本地。','ok'); return true; }
    catch(e) { console.error('[MufyCard] 衣柜 IndexedDB 保存失败',e); showToast('衣柜保存失败。请导出备份后重试，或减少图片大小。','err'); return false; }
  }
  const COMMANDS_KEY = 'mufycard_command_library_v1';
  let commandItems = [];
  try { const saved = JSON.parse(W.localStorage.getItem(COMMANDS_KEY) || '[]'); if (Array.isArray(saved)) commandItems = saved.filter(x => x && typeof x.name === 'string' && typeof x.text === 'string'); } catch (_) {}
  function saveCommandItems() { try { W.localStorage.setItem(COMMANDS_KEY, JSON.stringify(commandItems)); return true; } catch (e) { console.error('[MufyCard] 指令库保存失败', e); showToast('保存失败：本地存储空间可能不足。', 'err'); return false; } }
  function openCommandPage() { wardrobeView = 'commands'; renderCommandPage(); }
  function renderCommandPage(query = '') {
    const page = panel.querySelector('#wardrobe-page');
    ['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id => panel.querySelector('#'+id).style.display='none');
    panel.querySelector('#more-page').classList.remove('active'); page.classList.add('active');
    panel.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === 'tab-more'));
    const q = String(query || '').trim().toLowerCase();
    const filtered = commandItems.filter(x => !q || `${x.name} ${x.text} ${x.category || ''}`.toLowerCase().includes(q));
    page.innerHTML = `<div class="wardrobe-head"><button id="command-back" type="button">← 返回</button><strong>💲指令库</strong><button id="command-add" type="button" title="新增指令">＋</button></div><div class="wardrobe-tools"><input id="command-search" type="search" placeholder="搜索指令名称、正文或分类…" value="${escapeHtml(query)}" style="flex:1;min-width:0;background:#202027;color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:8px"></div><div class="command-list" id="command-list">${filtered.length ? filtered.map(x => `<article class="command-card" data-command-id="${escapeHtml(x.id)}"><div class="command-card-main"><div class="command-card-name">${escapeHtml(x.name)}</div><div class="command-card-preview">${escapeHtml(x.text)}</div>${x.category ? `<div class="command-card-tag">${escapeHtml(x.category)}</div>` : ''}</div><button type="button" data-command-copy="${escapeHtml(x.id)}">复制</button><button type="button" data-command-edit="${escapeHtml(x.id)}">编辑</button></article>`).join('') : '<div style="color:var(--dim);font-size:12px;text-align:center;padding:28px 8px">'+(commandItems.length ? '没有找到匹配的指令。' : '还没有保存指令，点击右上角 ＋ 添加第一条。')+'</div>'}</div>`;
    page.querySelector('#command-back').onclick = showMorePage;
    page.querySelector('#command-add').onclick = () => editCommandItem(null, query);
    // 搜索时只更新结果列表，不重建整个页面或替换输入框；
    // 否则 iOS 虚拟键盘可能因焦点反复丢失而出现重复字符/无法连续输入。
    page.querySelector('#command-search').addEventListener('input', e => {
      const q = String(e.target.value || '').trim().toLowerCase();
      const list = page.querySelector('#command-list');
      const matches = commandItems.filter(x => !q || `${x.name} ${x.text} ${x.category || ''}`.toLowerCase().includes(q));
      list.innerHTML = matches.length ? matches.map(x => `<article class="command-card" data-command-id="${escapeHtml(x.id)}"><div class="command-card-main"><div class="command-card-name">${escapeHtml(x.name)}</div><div class="command-card-preview">${escapeHtml(x.text)}</div>${x.category ? `<div class="command-card-tag">${escapeHtml(x.category)}</div>` : ''}</div><button type="button" data-command-copy="${escapeHtml(x.id)}">复制</button><button type="button" data-command-edit="${escapeHtml(x.id)}">编辑</button></article>`).join('') : '<div style="color:var(--dim);font-size:12px;text-align:center;padding:28px 8px">'+(commandItems.length ? '没有找到匹配的指令。' : '还没有保存指令，点击右上角 ＋ 添加第一条。')+'</div>';
      bindCommandResultActions(page, q);
    });
    bindCommandResultActions(page, query);
  }
  function bindCommandResultActions(page, query='') {
    page.querySelectorAll('[data-command-copy]').forEach(btn => btn.onclick = async () => { const item=commandItems.find(x=>x.id===btn.dataset.commandCopy); if(!item)return; try { if(W.navigator.clipboard?.writeText) await W.navigator.clipboard.writeText(item.text); else { const ta=document.createElement('textarea');ta.value=item.text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw new Error('copy failed'); } showToast('已复制指令。','ok'); } catch(_) { showToast('复制失败，请检查浏览器剪贴板权限。','err'); } });
    page.querySelectorAll('[data-command-edit]').forEach(btn => btn.onclick = () => editCommandItem(btn.dataset.commandEdit, query));
  }
  function editCommandItem(id, query='') {
    const existing = id ? commandItems.find(x=>x.id===id) : null;
    const overlay=document.createElement('div'); overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML=`<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>${existing?'编辑指令':'新增指令'}</strong><button type="button" data-close>×</button></div><label>指令名称<input id="command-name" type="text" maxlength="80" placeholder="例如：防止角色 OOC" value="${escapeHtml(existing?.name||'')}"></label><label>指令内容<textarea id="command-text" placeholder="粘贴或输入完整指令……" style="min-height:150px">${escapeHtml(existing?.text||'')}</textarea></label><label>分类（选填）<input id="command-category" type="text" maxlength="40" placeholder="例如：OOC、文风、剧情控制" value="${escapeHtml(existing?.category||'')}"></label><div class="detail-actions">${existing?'<button type="button" data-delete>删除</button>':''}<button type="button" data-save>保存</button><button type="button" data-cancel>取消</button></div></section>`;
    panel.appendChild(overlay); const close=()=>overlay.remove(); overlay.querySelector('[data-close]').onclick=close; overlay.querySelector('[data-cancel]').onclick=close;
    overlay.querySelector('[data-save]').onclick=()=>{const name=overlay.querySelector('#command-name').value.trim(),text=overlay.querySelector('#command-text').value.trim(),category=overlay.querySelector('#command-category').value.trim();if(!name||!text){showToast('请填写指令名称和指令内容。','err');return;}const value={id:existing?.id||('cmd-'+Date.now()+'-'+Math.random().toString(16).slice(2)),name,text,category,updatedAt:Date.now()};if(existing){const i=commandItems.findIndex(x=>x.id===existing.id);if(i>=0)commandItems[i]=value;}else commandItems.unshift(value);if(saveCommandItems()){close();renderCommandPage(query);showToast('指令已保存。','ok');}};
    const del=overlay.querySelector('[data-delete]');if(del)del.onclick=()=>{if(!confirm(`确定删除指令「${existing.name}」吗？`))return;commandItems=commandItems.filter(x=>x.id!==existing.id);if(saveCommandItems()){close();renderCommandPage(query);showToast('指令已删除。','ok');}};
  }

  // ================= 4.1 Preview 3：小u表情包 =================
  const STICKER_KEY='mufycard_stickers_v1';
  let stickerData={categories:['默认'],items:[]},stickerCategory='默认',stickerMulti=false,stickerSelected=new Set();
  try{const x=JSON.parse(W.localStorage.getItem(STICKER_KEY)||'null');if(x&&Array.isArray(x.categories)&&Array.isArray(x.items))stickerData=x;}catch(_){}
  function saveStickers(){try{W.localStorage.setItem(STICKER_KEY,JSON.stringify(stickerData));return true;}catch(_){showToast('表情包保存失败，可能是本地空间不足。','err');return false;}}
  function openStickerPage(){stickerCategory='默认';stickerMulti=false;stickerSelected.clear();renderStickerPage();}
  function renderStickerPage(){const page=panel.querySelector('#wardrobe-page');['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id=>panel.querySelector('#'+id).style.display='none');panel.querySelector('#more-page').classList.remove('active');page.classList.add('active');panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));const cats=['全部',...stickerData.categories];const items=stickerData.items.filter(x=>stickerCategory==='全部'||x.category===stickerCategory);page.innerHTML=`<div class="wardrobe-head"><button id="st-back">← 返回</button><strong>👀 小u表情包</strong><div style="display:flex;gap:6px"><button id="st-add">＋ 导入</button></div></div><div class="wardrobe-tools"><button id="st-newcat">＋ 分类</button><button id="st-multi">${stickerMulti?'退出多选':'多选'}</button>${stickerMulti?'<button id="st-all">全选</button><button id="st-move">批量移动</button><button id="st-delete">批量删除</button><span>已选 '+stickerSelected.size+'</span>':''}</div><div class="sticker-layout"><nav class="sticker-cats">${cats.map(c=>`<button class="sticker-cat ${c===stickerCategory?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</nav><div class="sticker-content"><div class="sticker-grid">${items.length?items.map(x=>`<article class="sticker-card" data-sid="${escapeHtml(x.id)}">${stickerMulti?`<input class="sticker-select" type="checkbox" ${stickerSelected.has(x.id)?'checked':''}>`:''}<div class="sticker-preview"><img loading="lazy" src="${escapeHtml(x.url)}" alt="${escapeHtml(x.description)}" onerror="this.style.display='none';this.parentElement.textContent='图片加载失败'"/></div><div class="sticker-actions"><button class="sticker-copy" data-copy-sticker="${escapeHtml(x.id)}">一键复制</button><button class="sticker-edit" data-edit-sticker="${escapeHtml(x.id)}">编辑</button></div></article>`).join(''):'<div style="grid-column:1/-1;text-align:center;color:var(--dim);padding:30px 8px">这个分类还没有表情包</div>'}</div></div></div>`;
    page.querySelector('#st-back').onclick=showMorePage;page.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{stickerCategory=b.dataset.cat;stickerSelected.clear();renderStickerPage();});page.querySelector('#st-newcat').onclick=()=>{const n=prompt('请输入分类名称');if(!n||!n.trim())return;const name=n.trim();if(stickerData.categories.includes(name)){showToast('分类已存在。','err');return;}stickerData.categories.push(name);stickerCategory=name;saveStickers();renderStickerPage();};page.querySelector('#st-add').onclick=()=>showStickerImportChoices();page.querySelector('#st-multi').onclick=()=>{stickerMulti=!stickerMulti;stickerSelected.clear();renderStickerPage();};const all=page.querySelector('#st-all');if(all)all.onclick=()=>{items.forEach(x=>stickerSelected.add(x.id));renderStickerPage();};const del=page.querySelector('#st-delete');if(del)del.onclick=()=>{if(!stickerSelected.size)return;if(!confirm(`确定删除选中的 ${stickerSelected.size} 个表情包？`))return;stickerData.items=stickerData.items.filter(x=>!stickerSelected.has(x.id));stickerSelected.clear();saveStickers();renderStickerPage();};const move=page.querySelector('#st-move');if(move)move.onclick=()=>{if(!stickerSelected.size)return;const opts=stickerData.categories.map((c,i)=>`${i+1}. ${c}`).join('\n');const n=prompt('输入目标分类序号：\n'+opts);const idx=Number(n)-1;if(!Number.isInteger(idx)||idx<0||idx>=stickerData.categories.length)return;const cat=stickerData.categories[idx];stickerData.items.forEach(x=>{if(stickerSelected.has(x.id))x.category=cat;});stickerSelected.clear();saveStickers();stickerCategory=cat;renderStickerPage();};page.querySelectorAll('.sticker-card').forEach(card=>{const cb=card.querySelector('.sticker-select');if(cb)cb.onchange=()=>{cb.checked?stickerSelected.add(card.dataset.sid):stickerSelected.delete(card.dataset.sid);};});page.querySelectorAll('[data-copy-sticker]').forEach(b=>b.onclick=async()=>{const x=stickerData.items.find(i=>i.id===b.dataset.copySticker);if(!x)return;const text=`$表情包：${x.description}：${x.url}`;try{await copyText(text);showToast('表情包内容已复制。','ok');}catch(_){showToast('复制失败，请检查剪贴板权限。','err');}});page.querySelectorAll('[data-edit-sticker]').forEach(b=>b.onclick=()=>editSticker(b.dataset.editSticker));}
  function showStickerImportChoices(){
    const page=panel.querySelector('#wardrobe-page');
    const overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML=`<section class="wardrobe-detail" style="max-width:360px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>导入表情包</strong><button type="button" data-close>×</button></div><div class="detail-actions" style="display:grid;grid-template-columns:1fr 1fr;margin-top:16px"><button type="button" data-manual>手动导入</button><button type="button" data-file>文件导入</button></div></section>`;
    page.appendChild(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();
    overlay.querySelector('[data-manual]').onclick=()=>{overlay.remove();stickerManualImport();};
    overlay.querySelector('[data-file]').onclick=()=>{overlay.remove();stickerFileImport();};
  }
  function stickerImportCategoryOptions(selected){
    return `<option value="">选择分类…</option>${stickerData.categories.map(c=>`<option value="${escapeHtml(c)}" ${c===selected?'selected':''}>${escapeHtml(c)}</option>`).join('')}<option value="__new__">＋ 新建分类</option>`;
  }
  function parseStickerLines(raw){
    const parsed=[];
    const lines=String(raw||'').replace(/\uFEFF/g,'').replace(/[\u200B-\u200D\u2060]/g,'').split(/\r\n|\n|\r/);
    for(const rawLine of lines){
      const line=rawLine.trim();if(!line)continue;
      // 兼容中文/英文冒号、复制文档时产生的空格，以及 URL 后面的标点。
      const match=line.match(/^(.*?)\s*[:：]\s*(https?:\/\/\S+)/i);
      if(!match)continue;
      const description=match[1].trim();
      let url=match[2].trim().replace(/[，。；;,]+$/,'');
      // 去除 URL 尾部常见的句末符号，但不触碰查询参数与签名。
      url=url.replace(/[)\]}>”’』」]+$/,'');
      if(!description||!/^https?:\/\//i.test(url))continue;
      try{const u=new URL(url);if(!/^https?:$/.test(u.protocol))continue;}catch(_){continue;}
      parsed.push({description,url});
    }
    return parsed;
  }
  function stickerImportForm(mode,raw,fileName=''){
    const page=panel.querySelector('#wardrobe-page'),overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';
    const initial=stickerCategory==='全部'?'默认':stickerCategory;
    overlay.innerHTML=`<section class="wardrobe-detail" style="display:flex;flex-direction:column;max-height:90%;min-height:0;width:min(520px,94vw)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex:0 0 auto"><strong>${mode==='manual'?'手动导入':'文件导入'}</strong><button type="button" data-close>×</button></div><label>导入到分类<select id="st-import-category" style="width:100%;margin-top:6px;background:#202027;color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:9px">${stickerImportCategoryOptions(initial)}</select></label><div id="st-new-category-wrap" style="display:none"><input id="st-new-category" placeholder="输入新分类名称" style="width:100%;box-sizing:border-box;background:#202027;color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:9px"></div>${mode==='manual'?`<label>表情包内容（默认一行一条）<textarea id="st-import-text" placeholder="开心：https://example.com/happy.png\n无语：https://example.com/blank.png" style="min-height:140px">${escapeHtml(raw||'')}</textarea></label>`:`<div style="font-size:12px;color:var(--dim);line-height:1.5">${escapeHtml(fileName||'已读取文件')}<br>请检查下面的识别预览；图片暂时无法加载也不会阻止导入。</div>`}<div id="st-import-count" style="font-size:12px;color:var(--dim);margin:4px 0"></div><div id="st-import-preview" style="display:grid;gap:7px;max-height:42vh;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;border-top:1px solid var(--border);padding-top:8px"></div><div class="detail-actions" style="flex:0 0 auto"><button type="button" data-confirm>确认导入</button><button type="button" data-cancel>取消</button></div></section>`;
    page.appendChild(overlay);
    const close=()=>overlay.remove();overlay.querySelector('[data-close]').onclick=close;overlay.querySelector('[data-cancel]').onclick=close;
    const cat=overlay.querySelector('#st-import-category'),newWrap=overlay.querySelector('#st-new-category-wrap');
    cat.onchange=()=>{newWrap.style.display=cat.value==='__new__'?'block':'none';};
    const text=overlay.querySelector('#st-import-text'),count=overlay.querySelector('#st-import-count'),preview=overlay.querySelector('#st-import-preview');
    const source=()=>mode==='manual'?(text?.value||''):raw;
    const update=()=>{
      const value=source(),parsed=parseStickerLines(value),total=value.split(/\r\n|\n|\r/).filter(x=>x.trim()).length,invalid=Math.max(0,total-parsed.length);
      count.textContent=`识别到 ${parsed.length} 条${invalid?`，另有 ${invalid} 行未识别`:''}。重复链接会保留；图片加载失败不影响导入。`;
      preview.innerHTML=parsed.length?parsed.map((x,i)=>`<div style="display:grid;grid-template-columns:58px minmax(0,1fr);gap:9px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><img src="${escapeHtml(x.url)}" alt="" loading="lazy" style="width:58px;height:58px;object-fit:contain;border-radius:6px;background:#17171d" onerror="this.style.opacity='.25';this.title='预览加载失败，仍可导入'"><div style="min-width:0"><div style="font-size:13px;color:var(--fg);overflow-wrap:anywhere">${escapeHtml(x.description)}</div><div style="font-size:11px;color:var(--dim);overflow-wrap:anywhere;margin-top:3px">${escapeHtml(x.url)}</div></div></div>`).join(''):'<div style="font-size:12px;color:var(--dim);padding:12px 4px">暂未识别到条目，请检查是否为“描述：图片链接”。</div>';
    };
    if(text)text.addEventListener('input',update);update();
    overlay.querySelector('[data-confirm]').onclick=()=>{
      let category=cat.value;if(category==='__new__')category=(overlay.querySelector('#st-new-category')?.value||'').trim();
      if(!category){showToast('请选择分类或新建分类。','err');return;}
      const parsed=parseStickerLines(source());
      if(!parsed.length){showToast('没有识别到有效内容，请检查描述和图片链接。','err');return;}
      if(!stickerData.categories.includes(category))stickerData.categories.push(category);
      parsed.forEach(x=>stickerData.items.unshift({id:'st-'+Date.now()+'-'+Math.random().toString(16).slice(2),...x,category,createdAt:Date.now()}));
      saveStickers();stickerCategory=category;stickerSelected.clear();close();renderStickerPage();showToast(`已导入 ${parsed.length} 个表情包。`,'ok');
    };
  }
  function stickerManualImport(){stickerImportForm('manual','');}
  async function stickerFileImport(){
    const input=document.createElement('input');input.type='file';input.accept='.txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{let raw='';if(/\.docx$/i.test(file.name)){if(typeof JSZip==='undefined')throw new Error('DOCX 解析组件未加载，请刷新页面后重试。');const zip=await JSZip.loadAsync(file);const doc=zip.file('word/document.xml');if(!doc)throw new Error('DOCX 文件中没有找到正文。');const xml=await doc.async('string');const parsed=new DOMParser().parseFromString(xml,'application/xml');raw=[...parsed.getElementsByTagName('w:p')].map(p=>[...p.getElementsByTagName('w:t')].map(t=>t.textContent||'').join('')).join('\n');}else{raw=await file.text();}if(!parseStickerLines(raw).length)throw new Error('没有识别到有效条目，请确认每行格式为「描述：URL」。');stickerImportForm('file',raw,file.name);}catch(e){showToast('文件读取失败：'+(e.message||'未知错误'),'err');}};input.click();
  }
  function editSticker(id){const x=stickerData.items.find(i=>i.id===id);if(!x)return;const d=prompt('编辑描述：',x.description);if(d===null)return;const u=prompt('编辑图片 URL：',x.url);if(u===null)return;let url;try{url=new URL(u.trim());if(!/^https?:$/.test(url.protocol))throw 0;}catch(_){showToast('URL 格式不正确。','err');return;}const c=prompt('所属分类：',x.category);if(c===null||!c.trim())return;const cat=c.trim();if(!stickerData.categories.includes(cat))stickerData.categories.push(cat);x.description=d.trim();x.url=url.href;x.category=cat;saveStickers();stickerCategory=cat;renderStickerPage();}
  async function copyText(text){if(W.navigator.clipboard?.writeText)return W.navigator.clipboard.writeText(text);const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw new Error('copy failed');}

  // ================= 4.1 Preview 3：善用备忘录 =================
  const NOTES_KEY='mufycard_notes_v1';let noteItems=[];
  try{const x=JSON.parse(W.localStorage.getItem(NOTES_KEY)||'[]');if(Array.isArray(x))noteItems=x;}catch(_){}
  function saveNotes(){try{W.localStorage.setItem(NOTES_KEY,JSON.stringify(noteItems));return true;}catch(_){showToast('备忘录保存失败。','err');return false;}}
  function openNotesPage(){renderNotesPage();}
  function noteTitle(n){return (n.title||n.body?.split(/\r?\n/)[0]||'新备忘录').trim().slice(0,80);}
  function renderNotesPage(query=''){
    const page=panel.querySelector('#wardrobe-page');
    ['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id=>panel.querySelector('#'+id).style.display='none');
    panel.querySelector('#more-page').classList.remove('active');page.classList.add('active');
    panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));
    const q=query.toLowerCase();
    const list=noteItems.filter(n=>!q||`${n.title||''} ${n.body||''}`.toLowerCase().includes(q)).sort((a,b)=>(!!b.pinned-!!a.pinned)||(b.updatedAt||0)-(a.updatedAt||0));
    page.innerHTML=`<div class="wardrobe-head"><button id="notes-back">← 返回</button><strong>📝 善用备忘录</strong><button id="notes-add">＋</button></div><div class="wardrobe-tools"><input id="notes-search" type="search" placeholder="搜索备忘录…" value="${escapeHtml(query)}" style="flex:1;min-width:0;background:#202027;color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:8px"></div><div class="note-list">${list.length?list.map(n=>`<div class="note-swipe" data-swipe-wrap="${escapeHtml(n.id)}"><div class="note-swipe-actions"><button type="button" data-note-pin="${escapeHtml(n.id)}">${n.pinned?'取消置顶':'置顶'}</button><button type="button" data-note-delete="${escapeHtml(n.id)}">删除</button></div><article class="note-row" data-note="${escapeHtml(n.id)}"><div class="note-title">${n.pinned?'📌 ':''}${escapeHtml(noteTitle(n))}</div><div class="note-preview">${escapeHtml((n.body||'').replace(/\s+/g,' ').slice(0,100))}</div><div class="note-meta">${new Date(n.updatedAt||Date.now()).toLocaleString()}</div></article></div>`).join(''):'<div style="text-align:center;color:var(--dim);padding:30px">还没有备忘录，点击右上角 ＋ 开始记录。</div>'}</div>`;
    page.querySelector('#notes-back').onclick=showMorePage;
    page.querySelector('#notes-add').onclick=()=>editNote(null);
    page.querySelector('#notes-search').oninput=e=>{const input=e.target;const pos=input.selectionStart;renderNotesPage(input.value);const next=page.querySelector('#notes-search');next.focus();next.setSelectionRange(pos,pos);};
    page.querySelectorAll('[data-note]').forEach(row=>row.onclick=()=>{if(row.classList.contains('swiped')){row.classList.remove('swiped');return;}editNote(row.dataset.note);});
    page.querySelectorAll('[data-note-pin]').forEach(btn=>btn.onclick=()=>{const n=noteItems.find(x=>x.id===btn.dataset.notePin);if(!n)return;n.pinned=!n.pinned;n.updatedAt=Date.now();saveNotes();renderNotesPage(query);});
    page.querySelectorAll('[data-note-delete]').forEach(btn=>btn.onclick=()=>{const n=noteItems.find(x=>x.id===btn.dataset.noteDelete);if(!n)return;if(!confirm('确定删除这篇备忘录？'))return;noteItems=noteItems.filter(x=>x.id!==n.id);saveNotes();renderNotesPage(query);});
    page.querySelectorAll('[data-swipe-wrap]').forEach(wrap=>{const row=wrap.querySelector('.note-row');let sx=0,sy=0,dx=0,tracking=false;row.addEventListener('touchstart',e=>{const t=e.touches[0];sx=t.clientX;sy=t.clientY;dx=0;tracking=true;},{passive:true});row.addEventListener('touchmove',e=>{if(!tracking)return;const t=e.touches[0];dx=t.clientX-sx;const dy=t.clientY-sy;if(Math.abs(dy)>Math.abs(dx)){tracking=false;return;}if(dx<0)row.style.transform=`translateX(${Math.max(-124,dx)}px)`;},{passive:true});row.addEventListener('touchend',()=>{if(!tracking)return;tracking=false;row.style.transform='';if(dx<-45)row.classList.add('swiped');else if(dx>45)row.classList.remove('swiped');});});
  }
  function editNote(id){
    const isNew=!id;
    const n=id?noteItems.find(x=>x.id===id):{id:'note-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),title:'',body:'',pinned:false,createdAt:Date.now(),updatedAt:Date.now()};if(!n)return;
    let committed=!isNew;
    const page=panel.querySelector('#wardrobe-page'),editor=document.createElement('section');editor.className='note-editor';
    editor.innerHTML=`<div class="note-toolbar"><button type="button" data-back>‹ 返回</button><span style="font-size:11px;color:var(--dim)" data-status>${isNew?'输入内容后自动保存':'已自动保存'}</span></div><input id="note-title" placeholder="标题" value="${escapeHtml(n.title||'')}"><textarea id="note-body" placeholder="开始记录…">${escapeHtml(n.body||'')}</textarea>`;
    page.appendChild(editor);const title=editor.querySelector('#note-title'),body=editor.querySelector('#note-body');let timer;
    const save=()=>{
      const hasContent=!!(title.value.trim()||body.value.trim());
      if(isNew&&!committed&&!hasContent){editor.querySelector('[data-status]').textContent='输入内容后自动保存';return;}
      n.title=title.value;n.body=body.value;n.updatedAt=Date.now();
      if(isNew&&!committed){noteItems.unshift(n);committed=true;}
      saveNotes();editor.querySelector('[data-status]').textContent='已保存';
    };
    [title,body].forEach(el=>el.addEventListener('input',()=>{editor.querySelector('[data-status]').textContent='正在保存…';clearTimeout(timer);timer=setTimeout(save,250);}));
    editor.querySelector('[data-back]').onclick=()=>{clearTimeout(timer);save();editor.remove();renderNotesPage();};title.focus();
  }

  function showMorePage() {
    wardrobeView = 'more';
    ['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id => panel.querySelector('#'+id).style.display='none');
    panel.querySelector('#more-page').classList.add('active'); panel.querySelector('#wardrobe-page').classList.remove('active');
    panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));
    panel.querySelector('#tab-more').classList.add('active');
  }
  function openWardrobe(type) {
    wardrobeType = type; wardrobeCategory = '全部'; wardrobeView='wardrobe'; renderWardrobe();
  }
  function renderWardrobe() {
    const page=panel.querySelector('#wardrobe-page');
    ['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id => panel.querySelector('#'+id).style.display='none');
    panel.querySelector('#more-page').classList.remove('active'); page.classList.add('active');
    panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));
    const group=wardrobeData[wardrobeType];
    const categories=['全部',...group.categories];
    page.innerHTML=`<div class="wardrobe-head"><button id="wardrobe-back" type="button">← 返回</button><strong>${wardrobeType==='user'?'🎀 User 衣柜':'👔 Char 衣柜'}</strong><button id="wardrobe-add" type="button" title="新增预设">＋</button></div><div class="wardrobe-tools"><select id="wardrobe-filter" aria-label="筛选分类">${categories.map(c=>`<option ${c===wardrobeCategory?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select><button id="wardrobe-category-add" type="button">＋ 分类</button><button id="wardrobe-category-manage" type="button">分类管理</button><button id="wardrobe-word-import" type="button">导入 Word</button><button id="wardrobe-multiselect" type="button">${wardrobeMultiSelect?'退出多选':'多选'}</button>${wardrobeMultiSelect?`<button id="wardrobe-select-all" type="button">全选</button><button id="wardrobe-bulk-move" type="button">批量移动分类</button><button id="wardrobe-bulk-delete" type="button">批量删除</button><span class="wardrobe-bulk-status">已选 ${wardrobeSelectedIds.size} 件</span>`:''}</div><div class="wardrobe-grid" id="wardrobe-grid"></div>`;;
    page.querySelector('#wardrobe-back').onclick=showMorePage;
    page.querySelector('#wardrobe-add').onclick=()=>editWardrobeItem(null);
    page.querySelector('#wardrobe-filter').onchange=e=>{wardrobeCategory=e.target.value;wardrobeSelectedIds.clear();renderWardrobe();};
    page.querySelector('#wardrobe-category-add').onclick=()=>{const name=prompt('请输入新分类名称');if(!name||!name.trim())return;const n=name.trim();if(group.categories.includes(n)){showToast('该分类已存在。','err');return;}group.categories.push(n);wardrobeCategory=n;void saveWardrobe();renderWardrobe();};
    page.querySelector('#wardrobe-category-manage').onclick=()=>showWardrobeCategoryManager();
    page.querySelector('#wardrobe-multiselect').onclick=()=>{wardrobeMultiSelect=!wardrobeMultiSelect;wardrobeSelectedIds.clear();renderWardrobe();};
    const grid=page.querySelector('#wardrobe-grid');
    const items=group.items.filter(i=>wardrobeCategory==='全部'||(Array.isArray(i.categories)?i.categories:(i.category?[i.category]:[])).includes(wardrobeCategory));
    if(!items.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#b8b8c5;padding:28px 8px">还没有这个分类的预设，点击右上角 ＋ 添加。</div>';}
    else {
      grid.innerHTML=items.map(i=>`<article class="wardrobe-card ${wardrobeSelectedIds.has(i.id)?'is-selected':''}" data-id="${escapeHtml(i.id)}">${wardrobeMultiSelect?`<input class="wardrobe-select-box" type="checkbox" aria-label="选择此预设" ${wardrobeSelectedIds.has(i.id)?'checked':''}>`:''}${i.image?`<img class="wardrobe-thumb" src="${i.image}" alt="穿搭参考图">`:'<div class="wardrobe-noimg">暂无图片</div>'}<div class="wardrobe-cardtext"><div class="wardrobe-desc">${escapeHtml(i.description)}</div>${wardrobeMultiSelect?'':'<button class="wardrobe-copy" type="button" data-copy="'+escapeHtml(i.id)+'">复制</button>'}</div></article>`).join('');
      grid.querySelectorAll('.wardrobe-card').forEach(card=>{card.addEventListener('click',e=>{if(e.target.closest('[data-copy]'))return;if(wardrobeMultiSelect){const id=card.dataset.id;if(wardrobeSelectedIds.has(id))wardrobeSelectedIds.delete(id);else wardrobeSelectedIds.add(id);renderWardrobe();return;}showWardrobeDetail(card.dataset.id);});});
      grid.querySelectorAll('.wardrobe-select-box').forEach(cb=>cb.addEventListener('click',e=>{e.stopPropagation();const id=cb.closest('.wardrobe-card').dataset.id;if(cb.checked)wardrobeSelectedIds.add(id);else wardrobeSelectedIds.delete(id);renderWardrobe();}));
      grid.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const i=group.items.find(x=>x.id===b.dataset.copy);if(!i)return;try{await W.navigator.clipboard.writeText(i.description);showToast('已复制完整穿搭描述。','ok');}catch(_){const ta=document.createElement('textarea');ta.value=i.description;page.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast('已复制完整穿搭描述。','ok');}});
    }
    const allBtn=page.querySelector('#wardrobe-select-all'); if(allBtn)allBtn.onclick=()=>{const all=items.every(i=>wardrobeSelectedIds.has(i.id));items.forEach(i=>all?wardrobeSelectedIds.delete(i.id):wardrobeSelectedIds.add(i.id));renderWardrobe();};
    const bulkBtn=page.querySelector('#wardrobe-bulk-move'); if(bulkBtn)bulkBtn.onclick=()=>showBulkCategoryDialog();
    const bulkDeleteBtn=page.querySelector('#wardrobe-bulk-delete'); if(bulkDeleteBtn)bulkDeleteBtn.onclick=async()=>{const ids=[...wardrobeSelectedIds];if(!ids.length){showToast('请先勾选需要删除的衣服。','err');return;}if(!confirm(`确定删除选中的 ${ids.length} 件穿搭吗？此操作无法撤销。`))return;group.items=group.items.filter(item=>!ids.includes(item.id));wardrobeSelectedIds.clear();if(await saveWardrobe()){wardrobeMultiSelect=false;renderWardrobe();showToast(`已删除 ${ids.length} 件穿搭。`,'ok');}};
    page.querySelector('#wardrobe-word-import').onclick=()=>importWardrobeWord();
  }
  function showWardrobeCategoryManager(){
    const group=wardrobeData[wardrobeType], page=panel.querySelector('#wardrobe-page');
    const overlay=document.createElement('div'); overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML=`<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>分类管理</strong><button type="button" data-close>×</button></div><p style="font-size:12px;color:#bdbdca">删除分类只会移除分类及衣服与该分类的关联，不会删除衣服、图片或描述。</p><div style="display:grid;gap:7px">${group.categories.length?group.categories.map(c=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px;border:1px solid #484454;border-radius:8px"><span style="overflow-wrap:anywhere">${escapeHtml(c)}</span><button type="button" data-delete-category="${escapeHtml(c)}">删除分类</button></div>`).join(''):'<div style="font-size:12px;color:#aaaab8">暂无分类</div>'}</div></section>`;
    page.appendChild(overlay); overlay.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>overlay.remove());
    overlay.querySelectorAll('[data-delete-category]').forEach(btn=>btn.onclick=async()=>{const name=btn.dataset.deleteCategory;if(!confirm(`确定删除分类「${name}」吗？衣服本身不会删除。`))return;group.categories=group.categories.filter(c=>c!==name);for(const item of group.items){const old=Array.isArray(item.categories)?item.categories:(item.category?[item.category]:[]);item.categories=old.filter(c=>c!==name);delete item.category;}if(wardrobeCategory===name)wardrobeCategory='全部';if(await saveWardrobe()){overlay.remove();renderWardrobe();showWardrobeCategoryManager();}});
  }
  function bindWardrobeMusicControls(page){
    const urlInput=page.querySelector('#wardrobe-music-url'), status=page.querySelector('#wardrobe-music-status'), play=page.querySelector('#wardrobe-music-play'), loop=page.querySelector('#wardrobe-music-loop'), volume=page.querySelector('#wardrobe-music-volume');
    if(!wardrobeAudio)return;
    try{if(urlInput&&!urlInput.value)urlInput.value=W.localStorage.getItem(WARDROBE_MUSIC_URL_KEY)||'';}catch(_){}
    const updateStatus=()=>{if(!status)return;status.textContent=wardrobeAudio.error?'播放失败：请确认是可直接访问的音频文件链接。':wardrobeAudio.src?(wardrobeAudio.paused?'已加载音频，点击播放。':'正在播放'+(wardrobeAudio.loop?'（循环）':'')):'请粘贴音频直链或选择本地音频文件。';if(play)play.textContent=wardrobeAudio.paused?'▶':'Ⅱ';play.setAttribute('aria-label',wardrobeAudio.paused?'播放':'暂停');play.title=wardrobeAudio.paused?'播放':'暂停';};
    if(volume){volume.value=String(wardrobeAudio.volume);volume.oninput=()=>{wardrobeAudio.volume=Number(volume.value);};}
    if(loop){loop.checked=wardrobeAudio.loop;loop.onchange=()=>{wardrobeAudio.loop=loop.checked;updateStatus();};}
    if(urlInput)urlInput.onkeydown=e=>{if(e.key==='Enter')page.querySelector('#wardrobe-music-load').click();};
    page.querySelector('#wardrobe-music-load').onclick=()=>{const url=(urlInput.value||'').trim();if(!url){showToast('请先粘贴直接音频链接。','err');return;}try{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol))throw new Error('protocol');if(wardrobeAudioObjectUrl){URL.revokeObjectURL(wardrobeAudioObjectUrl);wardrobeAudioObjectUrl='';}wardrobeAudio.src=parsed.href;wardrobeAudio.load();try{W.localStorage.setItem(WARDROBE_MUSIC_URL_KEY,parsed.href);}catch(_){}updateStatus();}catch(_){showToast('音频链接格式不正确。','err');}};
    play.onclick=async()=>{if(!wardrobeAudio.src){showToast('请先加载音频链接或选择本地文件。','err');return;}if(!wardrobeAudio.paused){wardrobeAudio.pause();updateStatus();return;}try{await wardrobeAudio.play();updateStatus();}catch(e){console.warn('[MufyCard] 音乐播放失败',e);if(status)status.textContent='播放被浏览器阻止或音频链接不可用，请再次点击播放并检查链接。';}};
    page.querySelector('#wardrobe-music-stop').onclick=()=>{wardrobeAudio.pause();try{wardrobeAudio.currentTime=0;}catch(_){}updateStatus();};
    const fileInput=page.querySelector('#wardrobe-music-file');page.querySelector('#wardrobe-music-pick').onclick=()=>fileInput.click();fileInput.onchange=()=>{const file=fileInput.files&&fileInput.files[0];if(!file)return;if(!file.type.startsWith('audio/')){showToast('请选择音频文件。','err');return;}if(wardrobeAudioObjectUrl)URL.revokeObjectURL(wardrobeAudioObjectUrl);wardrobeAudioObjectUrl=URL.createObjectURL(file);try{W.localStorage.removeItem(WARDROBE_MUSIC_URL_KEY);}catch(_){}wardrobeAudio.src=wardrobeAudioObjectUrl;wardrobeAudio.load();if(urlInput)urlInput.value='';updateStatus();};
    wardrobeAudio.onplay=updateStatus;wardrobeAudio.onpause=updateStatus;wardrobeAudio.onended=updateStatus;wardrobeAudio.onerror=updateStatus;updateStatus();
  }
  function showBulkCategoryDialog(){
    const group=wardrobeData[wardrobeType], ids=[...wardrobeSelectedIds]; if(!ids.length){showToast('请先勾选需要修改的衣服。','err');return;}
    const overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML=`<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center"><strong>批量修改分类（${ids.length} 件）</strong><button type="button" data-close>×</button></div><label>操作方式<select id="bulk-mode"><option value="add">添加分类（保留原分类）</option><option value="replace">替换分类（清除原分类）</option></select></label><label>选择分类<div id="bulk-cats" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${group.categories.map(c=>`<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" value="${escapeHtml(c)}" style="width:auto">${escapeHtml(c)}</label>`).join('')}</div></label><div class="detail-actions"><button type="button" data-apply>确认</button><button type="button" data-close>取消</button></div></section>`;
    panel.querySelector('#wardrobe-page').appendChild(overlay);overlay.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>overlay.remove());
    overlay.querySelector('[data-apply]').onclick=async()=>{const cats=[...overlay.querySelectorAll('#bulk-cats input:checked')].map(x=>x.value);if(!cats.length){showToast('请至少选择一个分类。','err');return;}const mode=overlay.querySelector('#bulk-mode').value;for(const item of group.items.filter(i=>ids.includes(i.id))){const old=Array.isArray(item.categories)?item.categories:(item.category?[item.category]:[]);item.categories=mode==='replace'?[...cats]:[...new Set([...old,...cats])];delete item.category;}if(await saveWardrobe()){overlay.remove();wardrobeSelectedIds.clear();wardrobeMultiSelect=false;renderWardrobe();}};
  }
  async function importWardrobeWord(){
    const input=document.createElement('input');input.type='file';input.accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';input.onchange=async()=>{const file=input.files&&input.files[0];if(!file)return;try{const parsed=await parseDocxWardrobe(file);if(!parsed.length)throw new Error('没有识别到衣服条目');const overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';overlay.innerHTML=`<section class="wardrobe-detail" style="display:flex;flex-direction:column;max-height:90%;min-height:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex:0 0 auto"><strong>Word 导入预览（识别到 ${parsed.length} 件）</strong><button type="button" data-close aria-label="关闭预览">×</button></div><div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin:8px 0;flex:0 0 auto"><p style="color:#bdbdca;font-size:12px;line-height:1.4;margin:0;flex:1">请检查图片和描述是否对应。导入后默认不设置分类。</p><button type="button" data-import style="flex:0 0 auto;white-space:nowrap">确认导入</button></div><div style="display:grid;gap:8px;max-height:60vh;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain">${parsed.map((x,i)=>`<div style="display:grid;grid-template-columns:80px minmax(0,1fr);gap:8px;border-bottom:1px solid #484454;padding:6px 0">${x.image?`<img src="${x.image}" style="width:80px;height:85px;object-fit:cover;object-position:center 42%;border-radius:6px">`:'<div style="color:#aaa">无图片</div>'}<div style="font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(x.description.slice(0,600))}</div></div>`).join('')}</div></section>`;panel.querySelector('#wardrobe-page').appendChild(overlay);overlay.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>overlay.remove());overlay.querySelector('[data-import]').onclick=async()=>{const group=wardrobeData[wardrobeType];for(const x of parsed)group.items.unshift({id:'w'+Date.now()+Math.random().toString(16).slice(2),description:x.description,categories:[],image:x.image||''});if(await saveWardrobe()){overlay.remove();wardrobeCategory='全部';wardrobeMultiSelect=false;wardrobeSelectedIds.clear();renderWardrobe();showToast(`已导入 ${parsed.length} 件衣服。`,'ok');}};}catch(e){console.error('[MufyCard] Word 导入失败',e);showToast('Word 解析失败：'+(e&&e.message?e.message:'未知错误')+'。请确认是 .docx 文件。','err');}};input.click();
  }
  async function parseDocxWardrobe(file){
    // Use JSZip rather than native DecompressionStream: Safari/iOS can throw
    // "Invalid type should be ArrayBuffer" when processing raw-deflate DOCX entries.
    if(!file || !/\.docx$/i.test(file.name||'')) throw new Error('请选择 .docx 格式的 Word 文件');
    if(typeof JSZip==='undefined') throw new Error('DOCX 解析组件未加载，请检查网络后刷新页面再试');
    let zip;
    try { zip = await JSZip.loadAsync(file); }
    catch(e) { throw new Error('DOCX 文件读取或解压失败：'+(e&&e.message||'文件可能已损坏')); }
    const docEntry=zip.file('word/document.xml');
    if(!docEntry) throw new Error('文件中缺少 word/document.xml，不是有效的 DOCX 文件');
    const dec = new TextDecoder();
    const xmlText = await docEntry.async('text');
    const xml = new DOMParser().parseFromString(xmlText,'application/xml');
    if(xml.querySelector('parsererror')) throw new Error('Word 文档 XML 解析失败');
    const relEntry=zip.file('word/_rels/document.xml.rels');
    const rels=new Map();
    if(relEntry){
      const rx=new DOMParser().parseFromString(await relEntry.async('text'),'application/xml');
      [...rx.getElementsByTagName('*')].filter(e=>(e.localName||'')==='Relationship').forEach(r=>{
        const id=r.getAttribute('Id'), target=r.getAttribute('Target');
        if(id&&target) rels.set(id,target);
      });
    }
    const imageCache=new Map();
    async function imageForRid(rid){
      if(!rid) return '';
      const target=rels.get(rid); if(!target) return '';
      let path=target.startsWith('/')?target.slice(1):'word/'+target.replace(/^\.\//,'');
      const parts=[];
      for(const seg of path.split('/')){if(seg==='..')parts.pop();else if(seg!=='.'&&seg)parts.push(seg);}
      path=parts.join('/');
      if(imageCache.has(path)) return imageCache.get(path);
      const entry=zip.file(path); if(!entry) return '';
      const bytes=new Uint8Array(await entry.async('uint8array'));
      let binary='';
      for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
      const ext=(path.split('.').pop()||'png').toLowerCase();
      const mime=({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff'})[ext]||'application/octet-stream';
      const result=`data:${mime};base64,${btoa(binary)}`; imageCache.set(path,result); return result;
    }
    const WNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const paragraphs=[...xml.getElementsByTagNameNS(WNS,'p')];
    const items=[]; let current=null;
    const getText=p=>[...p.getElementsByTagNameNS(WNS,'t')].map(t=>t.textContent||'').join('');
    const getRids=p=>[...p.getElementsByTagName('*')].map(el=>el.getAttributeNS(RNS,'embed')||el.getAttribute('r:embed')).filter(Boolean);
    const flush=()=>{if(current&&(current.description.trim()||current.image))items.push(current);};
    for(const para of paragraphs){
      const txt=getText(para).trim(); const rids=[...new Set(getRids(para))];
      const numberMatch=txt.match(/^(?:编号\s*)?(\d+)\s*[:：.、．)）]?\s*$/) || txt.match(/^编号\s*(\d+)\s*[:：]?\s*$/);
      if(numberMatch){flush();current={description:'',image:''};continue;}
      const fullNumber=txt.match(/^编号\s*\d+\s*[:：]?\s*(.*)$/);
      if(fullNumber){flush();current={description:fullNumber[1]||'',image:''};}
      else if(/^描述\s*[:：]?\s*$/.test(txt)||/^图片\s*[:：]?\s*$/.test(txt)){
        // Label-only paragraphs are structural markers, not garment text.
      } else {
        if(!current&&(txt||rids.length))current={description:'',image:''};
        if(current&&txt)current.description+=(current.description?'\n':'')+txt;
      }
      if(current&&rids.length&&!current.image){for(const rid of rids){const data=await imageForRid(rid);if(data){current.image=data;break;}}}
    }
    flush();
    return items.filter(x=>x.description.trim()).map(x=>({description:x.description.trim(),image:x.image||''}));
  }

  function loadMusicState(){
    try{musicTracks=JSON.parse(W.localStorage.getItem(MUSIC_TRACKS_KEY)||'[]').filter(t=>t&&t.url).map(t=>({...t,preset:false}));}catch(_){musicTracks=[];}
    musicTracks=[...PRESET_MUSIC_TRACKS.map((t,i)=>({...t,id:'preset-'+i,preset:true})),...musicTracks];
    try{const st=JSON.parse(W.localStorage.getItem(MUSIC_STATE_KEY)||'{}');musicIndex=Math.max(0,Number(st.index)||0);musicMode=['sequence','list','single','shuffle'].includes(st.mode)?st.mode:'sequence';musicRestoreTime=Math.max(0,Number(st.time)||0);musicCover=W.localStorage.getItem(MUSIC_COVER_KEY)||'';}catch(_){}
    if(wardrobeAudio){wardrobeAudio.loop=(musicMode==='single');const saved=musicTracks[musicIndex];if(saved?.url && (!wardrobeAudio.src || wardrobeAudio.src!==saved.url)){wardrobeAudio.src=saved.url;musicRestorePending=true;}}
  }
  function saveMusicState(){try{W.localStorage.setItem(MUSIC_STATE_KEY,JSON.stringify({index:musicIndex,mode:musicMode,time:wardrobeAudio?.currentTime||0}));}catch(_){}}
  function saveCustomTracks(){try{W.localStorage.setItem(MUSIC_TRACKS_KEY,JSON.stringify(musicTracks.filter(t=>!t.preset).map(({id,title,url,cover})=>({id,title,url,cover:cover||''}))));}catch(_){showToast('歌曲列表保存失败，可能是本地存储空间不足。','err');}}
  function openMusicPage(){loadMusicState();wardrobeView='music';const page=panel.querySelector('#wardrobe-page');['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id=>panel.querySelector('#'+id).style.display='none');panel.querySelector('#more-page').classList.remove('active');page.classList.add('active');panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));renderMusicPage();}
  function renderMusicPage(){
    const page=panel.querySelector('#wardrobe-page');const current=musicTracks[musicIndex];
    page.innerHTML=`<div class="wardrobe-head"><button id="music-back" type="button">← 返回</button><strong>♫ 音乐播放器</strong><span aria-hidden="true"></span></div><div style="padding:12px;overflow:auto;min-height:0;flex:1;text-align:center"><div id="music-vinyl" style="width:min(54vw,210px);height:min(54vw,210px);margin:8px auto 16px;border-radius:50%;background:radial-gradient(circle at 34% 27%,#1b1724 0%,#121019 35%,#0d0b13 68%,#09080e 86%,#191324 94%,#0d0b12 100%);display:flex;align-items:center;justify-content:center;${!wardrobeAudio?.paused?'animation:music-spin 4s linear infinite;':''}box-shadow:0 5px 24px #0008;position:relative;overflow:hidden"><div id="music-cover-art" style="width:35%;height:35%;border-radius:50%;background:${musicCover?'center/cover no-repeat url("'+escapeHtml(musicCover)+'")':'radial-gradient(circle at 32% 28%,#b6a0ed 0%,#8b73cb 42%,#5a467f 78%,#34283f 100%)'};border:2px solid #282231;box-shadow:inset 0 1px 3px #ffffff24,0 1px 4px #0007;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:13px">${musicCover?'':'♫'}</div></div><style>@keyframes music-spin{to{transform:rotate(360deg)}}#music-progress{appearance:none;-webkit-appearance:none;height:14px;background:transparent;cursor:pointer;display:block;margin:0 auto}#music-progress::-webkit-slider-runnable-track{height:2px;border-radius:999px;background:linear-gradient(to right,#a894e8 0%,#a894e8 var(--music-pct,0%),#514d5b var(--music-pct,0%),#514d5b 100%)}#music-progress::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:#d8cef9;border:0;margin-top:-4px;box-shadow:0 0 0 2px #17151e}#music-progress::-moz-range-track{height:2px;border-radius:999px;background:#514d5b}#music-progress::-moz-range-progress{height:3px;border-radius:999px;background:#a894e8}#music-progress::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#d8cef9;border:0}#music-prev,#music-next,#music-play{border:0!important;background:transparent!important;box-shadow:none!important;color:#eee9ff!important;font-size:25px;line-height:1;padding:7px 10px!important;min-width:42px;min-height:40px;border-radius:0!important}#music-play{font-size:27px!important}#music-url-row{display:flex;gap:7px;margin:0 0 12px}#music-url-input{flex:1;min-width:0;background:#252331!important;color:#f4f1ff!important;border:1px solid #514965!important;border-radius:8px;padding:10px 9px!important;font-size:12px}#music-url-import{background:#302a48!important;border:1px solid #665a91!important;color:#f2efff!important;border-radius:8px;padding:8px 10px!important;font-size:12px;white-space:nowrap}#music-mode{background:#252331!important;border:1px solid #514965!important;color:#e7defe!important;border-radius:999px!important;padding:7px 14px!important;font-size:12px!important;box-shadow:none!important}#music-list button[data-delete-track]{border:0!important;background:transparent!important;box-shadow:none!important;color:#fff!important;font-size:22px;line-height:1;padding:3px 8px!important;min-width:34px}</style><div id="music-current-title" style="font-size:16px;font-weight:700;overflow-wrap:anywhere">${escapeHtml(current?.title||'尚未选择歌曲')}</div><div id="music-time" style="font-size:11px;color:#aaa;margin:8px 0">00:00 / 00:00</div><input id="music-progress" type="range" min="0" max="1000" value="0" aria-label="播放进度" style="width:100%;accent-color:#a894e8"><div style="display:flex;justify-content:center;align-items:center;gap:10px;margin:12px 0"><button id="music-prev" type="button" aria-label="上一首" title="上一首">‹‹</button><button id="music-play" type="button" aria-label="${wardrobeAudio?.paused?'播放':'暂停'}" title="${wardrobeAudio?.paused?'播放':'暂停'}">${wardrobeAudio?.paused?'▶':'Ⅱ'}</button><button id="music-next" type="button" aria-label="下一首" title="下一首">››</button></div><div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button id="music-mode" type="button">${musicMode==='sequence'?'⇢ 顺序播放':musicMode==='list'?'↻ 列表循环':musicMode==='single'?'① 单曲循环':'🔀 随机播放'}</button></div><div id="music-url-row"><input id="music-url-input" type="url" placeholder="粘贴音乐 URL…" aria-label="音乐 URL"><button id="music-url-import" type="button">导入音乐 URL</button></div><div id="music-status" aria-live="polite" style="display:none"></div><div style="text-align:left;border-top:1px solid #484454;padding-top:10px"><strong>播放列表（${musicTracks.length}）</strong><div id="music-list" style="display:grid;gap:6px;margin-top:8px">${musicTracks.length?musicTracks.map((t,i)=>`<div style="display:flex;align-items:center;gap:6px;padding:7px;border:1px solid #484454;border-radius:8px;background:${i===musicIndex?'#8b7bff22':'#ffffff05'}"><button type="button" data-play-track="${i}" style="flex:1;text-align:left;border:0;background:transparent;min-width:0;overflow-wrap:anywhere">${i===musicIndex?'♫ ':''}${escapeHtml(t.title||'未命名歌曲')}${t.preset?' · 预设':''}</button>${!t.preset?`<button type="button" data-delete-track="${i}" aria-label="删除歌曲" title="删除歌曲">×</button>`:''}</div>`).join(''):'<div style="color:#aaa;font-size:12px">还没有歌曲，可以添加音频直链。</div>'}</div></div></div>`;
    page.querySelector('#music-back').onclick=showMorePage;
    page.querySelector('#music-prev').onclick=()=>playMusicAt(musicMode==='shuffle'?randomMusicIndex():musicIndex-1,true);
    page.querySelector('#music-next').onclick=()=>playMusicAt(musicMode==='shuffle'?randomMusicIndex():musicIndex+1,true);
    page.querySelector('#music-play').onclick=async()=>{if(!wardrobeAudio.src&&musicTracks[musicIndex]){wardrobeAudio.src=musicTracks[musicIndex].url;wardrobeAudio.loop=(musicMode==='single');}if(!wardrobeAudio.src){showToast('请先添加或选择一首歌曲。','err');return;}if(wardrobeAudio.paused){try{await wardrobeAudio.play();}catch(_){page.querySelector('#music-status').textContent='无法播放：请检查音频直链，或再次点击播放。';page.querySelector('#music-status').style.display='block';}}else wardrobeAudio.pause();renderMusicPage();};
    page.querySelector('#music-mode').onclick=(e)=>{e.preventDefault();e.stopPropagation();musicMode=musicMode==='sequence'?'list':musicMode==='list'?'single':musicMode==='single'?'shuffle':'sequence';wardrobeAudio.loop=(musicMode==='single');saveMusicState();const labels={sequence:'⇢ 顺序播放',list:'↻ 列表循环',single:'① 单曲循环',shuffle:'🔀 随机播放'};const btn=page.querySelector('#music-mode');if(btn)btn.textContent=labels[musicMode];};
    page.querySelector('#music-url-import').onclick=()=>{const input=page.querySelector('#music-url-input');const url=(input?.value||'').trim();if(!url){showToast('请先粘贴音乐 URL。','err');input?.focus();return;}try{const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw 0;const title=prompt('请输入歌曲名称（不填则使用“未命名歌曲”）')||'未命名歌曲';musicTracks.push({id:'custom-'+Date.now(),title:title.trim()||'未命名歌曲',url:u.href,preset:false});saveCustomTracks();musicIndex=musicTracks.length-1;wardrobeAudio.src=musicTracks[musicIndex].url;saveMusicState();renderMusicPage();}catch(_){showToast('链接格式不正确，请使用 http/https 音频直链。','err');}};
    page.querySelectorAll('[data-play-track]').forEach(b=>b.onclick=()=>playMusicAt(Number(b.dataset.playTrack),true));
    page.querySelectorAll('[data-delete-track]').forEach(b=>b.onclick=()=>{const idx=Number(b.dataset.deleteTrack),t=musicTracks[idx];if(!t||t.preset)return;if(!confirm(`删除歌曲「${t.title}」？`))return;const wasCurrent=idx===musicIndex;musicTracks.splice(idx,1);if(idx<musicIndex)musicIndex--;if(wasCurrent){wardrobeAudio.pause();wardrobeAudio.removeAttribute('src');wardrobeAudio.load();musicIndex=Math.min(musicIndex,Math.max(0,musicTracks.length-1));if(musicTracks[musicIndex])wardrobeAudio.src=musicTracks[musicIndex].url;}saveCustomTracks();saveMusicState();renderMusicPage();});
    const seek=page.querySelector('#music-progress');
    seek.addEventListener('pointerdown',()=>{musicSeeking=true;});
    seek.addEventListener('touchstart',()=>{musicSeeking=true;},{passive:true});
    seek.addEventListener('input',e=>{
      const duration=wardrobeAudio?.duration;
      if(Number.isFinite(duration)&&duration>0){
        const ratio=Math.max(0,Math.min(1,Number(e.target.value)/1000));
        wardrobeAudio.currentTime=ratio*duration;
        e.target.style.setProperty('--music-pct',`${ratio*100}%`);
        const fmt=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
        const time=page.querySelector('#music-time');if(time)time.textContent=`${fmt(ratio*duration)} / ${fmt(duration)}`;
      }
    });
    const endSeek=()=>{musicSeeking=false;updateMusicProgress();};
    seek.addEventListener('change',endSeek);seek.addEventListener('pointerup',endSeek);seek.addEventListener('touchend',endSeek,{passive:true});
    updateMusicProgress();if(!musicSeekTimer)musicSeekTimer=W.setInterval(updateMusicProgress,500);
  }
  function randomMusicIndex(){if(musicTracks.length<=1)return 0;let next=musicIndex;for(let tries=0;tries<8&&next===musicIndex;tries++)next=Math.floor(Math.random()*musicTracks.length);return next===musicIndex?(musicIndex+1)%musicTracks.length:next;}
  function playMusicAt(index,autoplay){if(!musicTracks.length){showToast('播放列表为空。','err');return;}if(musicMode==='shuffle'&&(index<0||index>=musicTracks.length))index=randomMusicIndex();else{if(index<0)index=musicMode==='list'?musicTracks.length-1:0;if(index>=musicTracks.length)index=musicMode==='list'?0:musicTracks.length-1;}musicIndex=index;const t=musicTracks[musicIndex];wardrobeAudio.loop=(musicMode==='single');wardrobeAudio.src=t.url;wardrobeAudio.load();saveMusicState();renderMusicPage();if(autoplay)wardrobeAudio.play().then(()=>renderMusicPage()).catch(()=>{const st=panel.querySelector('#music-status');if(st){st.textContent='歌曲已选择，但无法自动播放；请点击播放并检查链接。';st.style.display='block';}});}
  function updateMusicProgress(){if(!wardrobeAudio||wardrobeView!=='music')return;const p=panel.querySelector('#music-progress'),time=panel.querySelector('#music-time');if(!p||!time)return;const d=wardrobeAudio.duration||0,c=wardrobeAudio.currentTime||0;if(!musicSeeking){p.value=d?String(Math.round(c/d*1000)):'0';p.style.setProperty('--music-pct',`${d?Math.round(c/d*1000)/10:0}%`);}const fmt=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;time.textContent=`${fmt(c)} / ${fmt(d)}`;const vinyl=panel.querySelector('#music-vinyl');if(vinyl)vinyl.style.animationPlayState=wardrobeAudio.paused?'paused':'running';const play=panel.querySelector('#music-play');if(play)play.textContent=wardrobeAudio.paused?'▶':'Ⅱ';play.setAttribute('aria-label',wardrobeAudio.paused?'播放':'暂停');play.title=wardrobeAudio.paused?'播放':'暂停';saveMusicState();}
  loadMusicState();
  if(wardrobeAudio){wardrobeAudio.addEventListener('loadedmetadata',()=>{if(musicRestorePending&&musicRestoreTime>0&&Number.isFinite(wardrobeAudio.duration)){try{wardrobeAudio.currentTime=Math.min(musicRestoreTime,Math.max(0,wardrobeAudio.duration-1));}catch(_){} }musicRestorePending=false;});wardrobeAudio.addEventListener('ended',()=>{if(musicMode==='single'){if(!wardrobeAudio.loop){wardrobeAudio.currentTime=0;wardrobeAudio.play().catch(()=>{});}}else if(musicMode==='shuffle')playMusicAt(randomMusicIndex(),true);else if(musicMode==='list'||musicIndex<musicTracks.length-1)playMusicAt(musicIndex+1,true);else saveMusicState();});wardrobeAudio.addEventListener('play',()=>{const v=panel.querySelector('#music-vinyl');if(v)v.style.animationPlayState='running';});wardrobeAudio.addEventListener('pause',()=>{const v=panel.querySelector('#music-vinyl');if(v)v.style.animationPlayState='paused';});}
  function showWardrobeDetail(id) {
    const page=panel.querySelector('#wardrobe-page'), group=wardrobeData[wardrobeType], item=group.items.find(i=>i.id===id);if(!item)return;
    const overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML=`<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>穿搭详情</strong><button type="button" data-close>×</button></div>${item.image?`<img src="${item.image}" alt="穿搭参考图">`:''}<div class="detail-desc">${escapeHtml(item.description)}</div><div style="font-size:11px;color:var(--dim)">分类：${escapeHtml((item.categories|| (item.category?[item.category]:[])).join('、')||'未选择')}</div><div class="detail-actions"><button type="button" data-copy>复制完整描述</button><button type="button" data-edit>编辑</button><button type="button" data-delete>删除</button></div></section>`;
    page.appendChild(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelector('[data-copy]').onclick=async()=>{try{await W.navigator.clipboard.writeText(item.description);}catch(_){const ta=document.createElement('textarea');ta.value=item.description;overlay.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}showToast('已复制完整穿搭描述。','ok');};
    overlay.querySelector('[data-edit]').onclick=()=>{overlay.remove();editWardrobeItem(item);};
    overlay.querySelector('[data-delete]').onclick=()=>{if(confirm('确定删除这条穿搭预设吗？')){group.items=group.items.filter(x=>x.id!==id);void saveWardrobe();renderWardrobe();}};
  }
  function editWardrobeItem(existing) {
    const group=wardrobeData[wardrobeType], page=panel.querySelector('#wardrobe-page');
    const overlay=document.createElement('div');overlay.className='wardrobe-detail-backdrop';
    const cats=group.categories;
    overlay.innerHTML=`<section class="wardrobe-detail"><div style="display:flex;justify-content:space-between;align-items:center"><strong>${existing?'编辑预设':'新增预设'}</strong><button type="button" data-close>×</button></div><label>分类（可多选；不选则只显示在「全部」）<div id="w-cats" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0">${cats.map(c=>`<label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" value="${escapeHtml(c)}" style="width:auto;margin:0">${escapeHtml(c)}</label>`).join('')}</div><button type="button" id="w-add-category">＋ 新建分类</button></label><label>完整穿搭描述<textarea id="w-desc" placeholder="输入完整服装描述……"></textarea></label><label>参考图片（可选）<input id="w-image" type="file" accept="image/*"></label><div id="w-image-note" style="font-size:11px;color:var(--dim)">图片会压缩后保存在本地；建议使用较小图片。</div><div class="detail-actions"><button type="button" data-save>保存</button><button type="button" data-cancel>取消</button></div></section>`;
    page.appendChild(overlay);const q=s=>overlay.querySelector(s);if(existing){q('#w-desc').value=existing.description;const selected=existing.categories|| (existing.category?[existing.category]:[]);q('#w-cats').querySelectorAll('input[type=checkbox]').forEach(cb=>cb.checked=selected.includes(cb.value));}
    q('[data-close]').onclick=q('[data-cancel]').onclick=()=>overlay.remove();
    q('#w-add-category').onclick=()=>{const n=prompt('请输入新分类名称');if(!n||!n.trim())return;const name=n.trim();if(group.categories.includes(name)){showToast('该分类已存在。','err');return;}group.categories.push(name);const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:6px;margin:0';const cb=document.createElement('input');cb.type='checkbox';cb.value=name;cb.checked=true;cb.style.cssText='width:auto;margin:0';label.append(cb,document.createTextNode(name));q('#w-cats').appendChild(label);void saveWardrobe();};
    q('[data-save]').onclick=async()=>{const description=q('#w-desc').value.trim(),categories=[...q('#w-cats').querySelectorAll('input[type=checkbox]:checked')].map(cb=>cb.value);if(!description){showToast('请填写完整穿搭描述。','err');return;}let image=existing?.image||'';const file=q('#w-image').files?.[0];if(file){if(file.size>8*1024*1024){showToast('图片请小于 8MB。','err');return;}try{image=await resizeWardrobeImage(file);}catch(_){showToast('图片读取失败，请换一张图片。','err');return;}}const value={id:existing?.id||('w'+Date.now()+Math.random().toString(16).slice(2)),description,categories,image};if(existing){const idx=group.items.findIndex(x=>x.id===existing.id);if(idx>=0)group.items[idx]=value;}else group.items.unshift(value);if(await saveWardrobe()){overlay.remove();wardrobeCategory='全部';renderWardrobe();}};
  }
  function resizeWardrobeImage(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const max=900,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.78));};img.src=reader.result;};reader.readAsDataURL(file);});}

  function renderActiveTab() {
    if (activeTab === 'roles') renderFilteredRoles();
    else if (activeTab === 'archives') renderArchivePage();
    else renderMaskPage();
  }

  async function refreshRemoteMasks() {
    const button = panel?.querySelector('#mask-refresh-btn');
    const status = panel?.querySelector('#mask-status');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = '正在扫描网站面具…'; }
    if (status) status.textContent = '正在读取网站面具列表，请稍候…';
    const previousRemoteMasks = remoteMasks.slice();
    try {
      scanStoredAuth();
      const extractMaskRows = (value, depth = 0) => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object' || depth > 5) return [];
        for (const key of ['data', 'list', 'rows', 'records', 'items', 'content', 'results']) {
          if (Array.isArray(value[key])) return value[key];
        }
        for (const key of ['result', 'page', 'pagination']) {
          if (value[key] && typeof value[key] === 'object') {
            const rows = extractMaskRows(value[key], depth + 1);
            if (rows.length) return rows;
          }
        }
        return [];
      };
      const nextMasks = [];
      const pageSize = 100;
      for (let page = 1; page <= 50; page++) {
        const response = await apiRequest('/api/masks/query', 'POST', { page, pageNum: page, pageSize });
        const rows = extractMaskRows(response);
        nextMasks.push(...rows.map(m => ({
          source: 'remote', maskId: String(m.maskId ?? m.id ?? m.mask_id ?? ''),
          maskName: String(m.maskName ?? m.name ?? ''), gender: String(m.gender ?? ''),
          description: String(m.description ?? ''), favorite: String(m.favorite ?? ''),
          command: String(m.command ?? ''), remark: String(m.remark ?? ''), createdAt: String(m.createdAt ?? '')
        })).filter(m => m.maskId));
        const pageUnique = new Map();
        for (const m of nextMasks) pageUnique.set(m.maskId, m);
        remoteMasks = [...pageUnique.values()];
        if (activeTab === 'masks') renderMaskPage();
        if (status) status.textContent = `正在扫描网站面具：已读取 ${remoteMasks.length} 个…`;
        const total = Number(response?.total ?? response?.totalCount ?? response?.pagination?.total);
        const hasNext = response?.hasNext ?? response?.hasMore ?? response?.pagination?.hasNext;
        if (!rows.length || hasNext === false || (Number.isFinite(total) && total > 0 && nextMasks.length >= total) || (hasNext !== true && rows.length < pageSize)) break;
      }
      // 只有成功拿到响应后才替换远端缓存；失败时保留旧数据，且绝不触碰本地面具。
      if (!nextMasks.length) throw new Error('接口没有返回面具数据；原有缓存已保留。');
      const unique = new Map();
      for (const m of nextMasks) unique.set(m.maskId, m);
      remoteMasks = [...unique.values()];
      saveRemoteMasks();
      if (status) status.textContent = `网站面具刷新完成：${remoteMasks.length} 个；本地面具 ${localMasks.length} 个。`;
      renderMaskPage();
    } catch (e) {
      remoteMasks = previousRemoteMasks || remoteMasks;
      console.warn('[MufyCard 3.3.6 预览版 6] 面具刷新失败：', e);
      if (status) status.textContent = `刷新失败：${e?.message || e}（旧缓存已保留）`;
      if (activeTab === 'masks') renderMaskPage();
    } finally {
      if (button) { button.disabled = false; button.textContent = '↻ 扫描/刷新网站面具'; }
    }
  }

  function renderMaskPage() {
    if (!listContainer) return;
    listContainer.classList.remove('archive-list');
    panel.querySelector('#mask-view-local')?.classList.toggle('active', maskView === 'local');
    panel.querySelector('#mask-view-cached')?.classList.toggle('active', maskView === 'remote');
    const all = maskView === 'local'
      ? localMasks.map(m => ({ ...m, _key: `local:${m.localId}`, _source: '本地面具' }))
      : remoteMasks.map(m => ({ ...m, _key: `remote:${m.maskId}`, _source: '已缓存面具' }));
    const q = String(maskSearchQuery || '').trim().toLocaleLowerCase();
    const filtered = all.filter(m => !q || [m.remark,m.maskName,m.gender,m.description,m.favorite,m.command].some(v => String(v||'').toLocaleLowerCase().includes(q)));
    listContainer.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.style.cssText = 'text-align:center;color:#8e8e9e;padding:24px 12px;font-size:12px';
      empty.textContent = all.length ? '没有匹配的面具' : (maskView === 'local' ? '还没有本地面具，点击上方「新增本地面具」创建。' : '还没有已缓存面具，点击上方「扫描/刷新网站面具」读取。'); listContainer.appendChild(empty); return;
    }
    for (const m of filtered) {
      const card = document.createElement('section'); card.className = 'mask-card';
      const remark = document.createElement('div'); remark.className = 'mask-remark';
      remark.textContent = m.remark.trim() || '未填写备注';
      const source = document.createElement('small'); source.textContent = m._source; remark.appendChild(source); card.appendChild(remark);
      const preview = document.createElement('div'); preview.className = 'mask-preview';
      const title = document.createElement('strong'); title.textContent = m.maskName || '未命名面具'; preview.appendChild(title);
      const gender = document.createElement('div'); gender.textContent = `性别：${m.gender || '未填写'}`; preview.appendChild(gender);
      const desc = document.createElement('div'); desc.className = 'mask-snippet'; desc.textContent = `描述：${m.description || '暂无描述'}`; preview.appendChild(desc);
      const fav = document.createElement('div'); fav.className = 'mask-snippet'; fav.textContent = `喜好：${m.favorite || '暂无喜好'}`; preview.appendChild(fav); card.appendChild(preview);
      const boundRoles = m.maskId ? scannedRoles.filter(r => String(r.maskId ?? '') === String(m.maskId)) : [];
      const bound = document.createElement('div');
      bound.className = 'mask-snippet';
      bound.textContent = `绑定角色卡：${boundRoles.length ? boundRoles.map(r => r.name || `角色 ${r.id}`).join('、') : '暂未从已扫描角色中识别到'}`;
      preview.appendChild(bound);
      const expanded = expandedMaskId === m._key;
      card.onclick = () => { expandedMaskId = expanded ? '' : m._key; renderMaskPage(); };
      if (expanded) {
        const detail = document.createElement('div'); detail.className = 'mask-detail';
        for (const [label,value] of [['备注',m.remark],['名称',m.maskName],['性别',m.gender],['我的描述',m.description],['我的喜好',m.favorite],['指令',m.command]]) {
          const l = document.createElement('label'); l.textContent = label; detail.appendChild(l);
          const v = document.createElement('div'); v.textContent = value || '（未填写）'; detail.appendChild(v);
        }
        const boundDetail = document.createElement('div');
        const boundLabel = document.createElement('label'); boundLabel.textContent = '已绑定的角色卡'; boundDetail.appendChild(boundLabel);
        const boundValue = document.createElement('div'); boundValue.textContent = boundRoles.length ? boundRoles.map(r => r.name || `角色 ${r.id}`).join('、') : '暂未从已扫描角色中识别到'; boundDetail.appendChild(boundValue); detail.appendChild(boundDetail);
        if (m._source === '本地面具') {
          const actions = document.createElement('div'); actions.className = 'mask-actions';
          const edit = document.createElement('button'); edit.textContent = '编辑'; edit.onclick = e => { e.stopPropagation(); renderMaskForm(m); };
          const del = document.createElement('button'); del.textContent = '删除本地面具'; del.onclick = async e => { e.stopPropagation(); if (confirm(`确定删除本地面具「${m.remark || m.maskName || '未命名'}」吗？`)) { localMasks = localMasks.filter(x => x.localId !== m.localId); await saveLocalMasks(); expandedMaskId=''; renderMaskPage(); } };
          actions.append(edit,del); detail.appendChild(actions);
        }
        card.appendChild(detail);
      }
      listContainer.appendChild(card);
    }
  }

  function setMaskView(view) {
    maskView = view === 'remote' ? 'remote' : 'local';
    renderMaskPage();
  }

  function renderMaskForm(mask = null) {
    if (activeTab !== 'masks') switchTab('masks');
    // 表单独立放在面具栏目容器之上，不放进会随扫描进度重绘的列表里。
    panel.querySelector('#mask-modal')?.remove();
    const modal = document.createElement('div'); modal.className = 'mask-modal'; modal.id = 'mask-modal';
    const form = document.createElement('div'); form.className = 'mask-form';
    const heading = document.createElement('strong'); heading.textContent = mask ? '编辑本地面具' : '新增本地面具'; form.appendChild(heading);
    const fields = [
      ['remark','备注','例如：角色 A',false], ['maskName','名称','面具名称',false], ['gender','性别','性别',false],
      ['description','我的描述','填写角色描述',true], ['favorite','我的喜好','填写喜好',true], ['command','指令','填写指令',true]
    ];
    const inputs = {};
    for (const [key,label,placeholder,multi] of fields) {
      const input = document.createElement(multi ? 'textarea' : 'input'); input.placeholder = placeholder; input.value = mask?.[key] || ''; input.style.color = '#fff'; input.setAttribute('aria-label',label); inputs[key] = input;
      const lab = document.createElement('label'); lab.textContent = label; form.appendChild(lab); form.appendChild(input);
    }
    const buttons = document.createElement('div'); buttons.className = 'form-buttons';
    const save = document.createElement('button'); save.textContent = '保存'; save.onclick = async () => {
      const value = {}; for (const [key] of fields) value[key] = inputs[key].value.trim();
      if (!value.remark && !value.maskName) { alert('请至少填写备注或名称。'); return; }
      if (mask) {
        const existing = localMasks.find(x => x.localId === mask.localId);
        if (existing) Object.assign(existing, value);
      } else localMasks.unshift({ ...value, localId: `local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, source: 'local', createdAt: new Date().toISOString() });
      const saved = await saveLocalMasks(); if (!saved) return; modal.remove(); maskView = 'local'; renderMaskPage();
    };
    const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => modal.remove();
    buttons.append(save,cancel); form.appendChild(buttons); modal.appendChild(form);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    panel.appendChild(modal); form.scrollTop = 0;
  }

  // ================= Preview 8：完整备份 / 恢复 =================
  const BACKUP_SCHEMA = 'mufycard-full-backup-v1';
  const PERSONA_KEY = 'mufycard_persona_saved_v1';
  const PERSONA_LIBRARY_KEY = 'mufycard_persona_library_v1';
  function backupDownload(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.documentElement.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2500);
  }
  function getPageLocalData() {
    const out={};
    try { for(let i=0;i<W.localStorage.length;i++){const k=W.localStorage.key(i);if(k && /^mufycard_/i.test(k)){out[k]=W.localStorage.getItem(k);}} } catch(e) { throw new Error('读取网页本地数据失败：'+e.message); }
    return out;
  }
  async function getGMData() {
    const out={}; let keys=[];
    try { if(typeof GM!=='undefined' && typeof GM.listValues==='function') keys=await GM.listValues(); else if(typeof GM_listValues==='function') keys=await GM_listValues(); } catch(e) { console.warn('[MufyCard] GM key listing unavailable',e); }
    for(const k of keys){try{let v;if(typeof GM!=='undefined'&&typeof GM.getValue==='function')v=await GM.getValue(k);else if(typeof GM_getValue==='function')v=await GM_getValue(k);out[k]=v;}catch(e){console.warn('Skip GM key',k,e);}}
    return out;
  }
  async function readWardrobeBackupDB(){try{return await readWardrobeDB();}catch(_){return null;}}
  async function makeFullBackup(){
    await scanCacheWriteQueue.catch(()=>{});
    const payload={format:BACKUP_SCHEMA,app:'MufyCard',version:'4.1.0',createdAt:new Date().toISOString(),accountScope:ACCOUNT_CACHE_ID,stores:{pageLocalStorage:getPageLocalData(),gm:await getGMData(),indexedDB:{[WARDROBE_DB]:{wardrobe:await readWardrobeBackupDB()}}}};
    return payload;
  }
  function showBackupChoices(){
    const old=panel.querySelector('#backup-chooser');if(old)old.remove();
    const overlay=document.createElement('div');overlay.id='backup-chooser';overlay.className='wardrobe-detail-backdrop';
    overlay.innerHTML='<section class="wardrobe-detail" style="max-width:360px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>数据备份</strong><button type="button" data-close>×</button></div><div class="detail-actions" style="display:grid;grid-template-columns:1fr 1fr;margin-top:16px"><button type="button" data-export>导出</button><button type="button" data-import>导入</button></div><p style="font-size:11px;color:var(--dim);line-height:1.5;margin:12px 0 0">导出 MufyCard 本地数据；导入会恢复备份中的数据，并覆盖当前同名 MufyCard 数据。建议先导出当前数据留档。</p></section>';
    panel.appendChild(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelector('[data-export]').onclick=async()=>{try{showToast('正在整理本地数据…','ok');const data=await makeFullBackup();backupDownload(`MufyCard_Backup_${new Date().toISOString().slice(0,10)}.json`,data);showToast('完整备份已导出。','ok');}catch(e){console.error(e);showToast('备份失败：'+e.message,'err');}};
    overlay.querySelector('[data-import]').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const obj=JSON.parse(await file.text());if(obj?.format!==BACKUP_SCHEMA||!obj.stores?.pageLocalStorage||!obj.stores?.gm)throw new Error('不是 MufyCard 完整备份文件（支持 Preview 7/8/9）');if(!confirm('即将恢复备份。备份中的 MufyCard 本地数据会覆盖当前同名数据，其他网站数据不会被修改。建议确认你已另存当前数据。继续吗？'))return;await restoreFullBackup(obj);overlay.remove();showToast('备份恢复完成，请刷新页面。','ok');}catch(e){console.error('[MufyCard] restore failed',e);showToast('导入失败：'+e.message,'err');}};input.click();};
  }
  async function restoreFullBackup(obj){
    const page=obj.stores.pageLocalStorage||{}, gm=obj.stores.gm||{};
    // Validate everything before changing storage.
    for(const [k,v] of Object.entries(page)){if(!/^mufycard_/i.test(k)||typeof v!=='string')throw new Error('备份中包含无效网页存储项');}
    // Restore local keys as a scoped replacement, preserving unrelated site keys.
    const existing=[];for(let i=0;i<W.localStorage.length;i++){const k=W.localStorage.key(i);if(k&&/^mufycard_/i.test(k))existing.push(k);}existing.forEach(k=>W.localStorage.removeItem(k));
    for(const [k,v] of Object.entries(page))W.localStorage.setItem(k,v);
    // Restore userscript storage. Remove current script keys missing from the backup, then write all archived values.
    let current=[];try{if(typeof GM!=='undefined'&&typeof GM.listValues==='function')current=await GM.listValues();else if(typeof GM_listValues==='function')current=await GM_listValues();}catch(_){}
    for(const k of current){if(!(k in gm)){try{if(typeof GM!=='undefined'&&typeof GM.deleteValue==='function')await GM.deleteValue(k);else if(typeof GM_deleteValue==='function')await GM_deleteValue(k);}catch(e){console.warn('Could not remove GM key',k,e);}}}
    for(const [k,v] of Object.entries(gm)){if(typeof GM!=='undefined'&&typeof GM.setValue==='function')await GM.setValue(k,v);else if(typeof GM_setValue==='function')await GM_setValue(k,v);}
    const wardrobe=obj.stores.indexedDB?.[WARDROBE_DB]?.wardrobe;if(wardrobe)await writeWardrobeDB(wardrobe);
  }

  // ================= 4.1：以角色关系为核心的人设灵感（扩充素材库） =================
  // 不生成姓名、年龄、外貌；世界观、身份类别、关系和性格可自定义。
  const personaLibrary = {
    modern: [
      '私人幕僚','专属顾问','私人造型师','独立调停人','私人史官','专属伴读','私人心理倾听师','小众手作匠人','隐退企业管理者','低调世家后人','匿名博主','幕后策划人','隐形投资人','私人收藏者','独立研究者','长期隐居者',
      '档案管理员','文物修复员','气象观测员','地质勘测员','航道监测员','档案馆文员','宠物殡葬师','整理收纳师','酒店试睡员','茶叶品鉴师','香氛评测师','文具品鉴师','陪诊师','商业代拍摄影师','短视频脚本策划','影视场务','灯光师','现场收音师','剪辑助理','艺人经纪助理','粉丝站摄影师','幕后词曲创作者','影视调色师',
      '危机干预接线员','殡葬礼仪师','法医技术助理','警犬训导员','海关查验员','随行口译员','古籍整理师','独立策展人','私人图书管理员','宠物行为顾问','植物养护师','钟表维修师','标本制作师','档案数字化专员','城市观察记录者','自由旅居者','全职陪伴者','隐秘收藏爱好者','小众社群组织者','私圈活动策划人','独立调香师','私人礼宾顾问',
      '买手店主理人','画廊运营','拍卖行图录编辑','艺术品经纪人','版权代理','出版社责任编辑','有声书导演','配音演员','舞台监督','道具师','服装管理','艺人宣传','公关顾问','品牌危机公关','用户研究员','数据标注质检员','产品体验测试员','无障碍体验顾问','社区运营','论坛版主','独立游戏编剧','婚礼策划师','私人管家','家庭教师','留学文书顾问','遗产事务助理','保险理赔调查员','物业管家','房屋托管人','宠物寄养家庭经营者','花艺师','古董修复师','皮具护理师','鞋履修复师','香水调配师','咖啡烘焙师','烘焙研发师','食品感官评价员','睡眠产品测试员','展会搭建统筹','活动执行导演','无人机航拍摄影师','潜水摄影师','气象播报编辑','科研项目协调员','临床研究协调员','实验室样本管理员','病案编码员','医疗器械临床专员','社区社工','职业规划顾问','调解员','遗嘱执行事务助理','私人旅行定制师','航空地勤协调员','船舶代理','港口调度员','铁路信号维护员','园林养护师','生态调查员','野生动物救护员','水族馆饲养员','马术教练','宠物美容师','犬只行为训练师'
    ],
    ancient: [
      '尚宫局女官','御厨学徒','御医学徒','守陵人','宫门值守','传旨内侍','行宫留守','货郎','走方郎中','说书人','戏班后台乐师','裱糊匠','磨刀匠','摆渡人','驿站驿卒','当铺朝奉','情报贩子','江湖掮客','镖队账房','药童','守山人','渡客','隐世医者','市井打手','帮派文书','罪臣之后','流放归乡人','商户庶出','世家弃子','入赘婿','守孝人','义庄看守','民间接生婆','香烛铺掌柜','戏服修补匠','抄书人','碑刻匠','茶肆跑堂','船家','更夫','典当行学徒','园林匠人','宫中花匠','宗族账房','私塾先生'
    ],
    fictional: ['架空世界中的普通居民','异世界旅人','人造生命','拟态生物','精灵族成员','兽人族成员','神明的代理人','守界人','位面旅人','拥有特殊能力的普通职业者','其他自定义架空身份'],
    nonhuman: ['动物','拟人动物','灵物','精灵','神明或神使','人造生命','AI意识体','其他非人存在'],
    relations: [
      '普通朋友','认识多年的旧友','刚认识却异常投缘','童年玩伴','失散多年的亲人','没有血缘关系的兄弟姐妹','继兄弟／继姐妹','名义上的家人','收养者与被收养者','监护人与被监护者','邻居','合租室友','房东与租客','同学','同桌','学长／学姐与学弟／学妹','老师与学生','补习老师与学生','社团前辈与后辈','竞争对手','死对头','宿敌','前任','分手后仍有牵连的人','暗恋对象','双向暗恋但无人挑明','暧昧对象','网恋对象','网友奔现','曾经的约定对象','被迫联姻对象','契约伴侣','名义伴侣','秘密恋人','旧情复燃','替身与被替代者','白月光','求而不得的人','曾经背叛自己的人','被自己辜负的人','救命恩人与被救者','债主与欠债人','委托人与受托人','雇主与私人助理','上司与下属','老板与合伙人','同事','客户与专属顾问','医生与长期患者','律师与委托人','艺人与经纪人','艺人与私人造型师','创作者与灵感缪斯','作者与责任编辑','房东与神秘租客','邻里之间的秘密盟友','互相利用的合作关系','表面合作的竞争者','共同保守秘密的人','被安排在身边监视的人','负责保护自己的人','暗中保护自己的人','被自己保护的人','彼此身份互换的人','失忆前就认识的人','只在特定场合见面的人','曾经的搭档','被迫组成的搭档','师徒','引路人与追随者','信徒与信仰对象','守护者与被守护者','主人与宠物','饲养者与动物','动物与常来照顾它的人','自定义关系'
    ],
    traits: ['外热内冷','外冷内热','慢热谨慎','温柔但有距离感','嘴硬心软','表面圆滑、内心固执','情绪稳定','敏感细腻','观察力敏锐','责任感很强','不擅长表达','擅长察言观色','习惯性伪装','社交能力强但喜欢独处','清醒理性','温柔悲观','乐观随性','控制欲较强','占有欲明显','边界感很强','讨好倾向','防备心重','容易心软','记仇但不主动报复','幽默毒舌','礼貌疏离','看似散漫实则可靠','极度自律','随性自由','缺乏安全感','极度独立','依赖熟悉的人','双面反差','不轻易信任别人','共情能力强','习惯把情绪藏起来'],
    hooks: ['隐藏真实身份','有一段不愿提起的过去','被某人暗中守护','背负家族秘密','曾被当作替代品','与对方有一份未兑现的约定','两人之间存在信息差','曾经不告而别','一直隐瞒一件小事','被寄托了某种希望','看似偶然的相遇其实早有缘由','曾经站在关系的另一边','双方记忆中的同一件事并不一样','因为某个误会保持距离','只有对方知道自己的另一面','关系中存在未说出口的亏欠','过去曾经互相帮助却没有认出彼此','正在寻找失联的人','曾经隐退，如今被旧事牵回','与某个地方有未解的羁绊'],
    relationsExtra: [
      '对方曾经的邻居，如今因工作再次相遇','对方家人的旧友','对方最信任之人的竞争者','对方秘密委托的调查顾问','对方曾经帮助过、却早已忘记的人','对方一直误认身份的人','对方的匿名倾诉对象','对方作品的长期支持者','对方曾经的直属上司','对方的临时监护人','对方的合作方代表','对方的旧友的现任伴侣','对方家族生意的合作伙伴','对方曾经的室友的朋友','对方不愿公开的商业伙伴','对方的长期客户','对方的私人医生或顾问','对方曾经的救助对象','对方的失联联系人','对方的秘密知情者','对方在陌生城市的引路人','对方的债务担保人','对方曾经的面试官','对方的匿名竞争者','对方的远房亲戚','对方的社交圈边缘熟人','对方被迫共事的搭档','对方的旧项目合作者','对方的邻居兼临时照看者','对方唯一知道其真实处境的人'
    ],
    meeting: ['在一次临时委托中认识','因共同朋友而熟悉','曾在同一地点长期生活却未深交','一次意外事件后保持联系','因工作往来逐渐熟悉','在网络社群相识，后来在线下见面','曾经关系亲近，因生活变化疏远','最初互相误解，后来不得不合作','由一段共同保守的秘密牵连','在对方人生低谷时出现','因一件遗失物品重新联系','原本只是点头之交，后来产生交集','被共同的第三人介绍认识','曾经短暂共事，留下深刻印象','在某个固定场所反复遇见'],
    habits: ['习惯先听完再表达意见','会记住别人随口提过的小事','遇到压力时整理桌面或物品','不喜欢即时回复消息，但会认真回复','习惯提前规划，也会留出意外空间','说话前常短暂停顿','习惯用行动代替安慰','喜欢收集票根、标签或小纸片','对熟人会不自觉地操心','独处时会反复琢磨对话细节','做事有固定顺序，不喜欢被打断','常把重要事项写在纸上','不擅长拒绝临时请求','习惯观察环境后才加入谈话','对承诺过的事情记得很清楚','心情不好时会减少社交','喜欢给日常物品分类','会在不经意间讲冷笑话','不爱解释自己的决定','习惯用问题代替直接表达关心'],
    values: ['重视承诺胜过漂亮话','认为个人边界不可随意越过','看重长期稳定的关系','更相信实际行动而非身份地位','无法接受利用弱者获利','认为诚实重要，但隐私同样重要','重视自由，不喜欢被安排人生','把家人和亲近之人放在优先位置','认为公平比效率更重要','不愿为了合群放弃原则','相信每个人都应有重新开始的机会','看重专业能力与可靠程度','认为关系需要双向维护','珍惜独处与精神空间','不喜欢亏欠别人，也不轻易接受施舍'],
    motives: ['想弥补过去一次没有兑现的承诺','希望证明自己并非他人眼中的样子','想保护某个不愿公开的人','正在寻找一个可靠的合作机会','希望摆脱长期被安排的生活','想弄清一段关系为何中断','想守住来之不易的平静生活','希望获得真正的认可','正在偿还一份旧日人情','想把某项技能或事业做出成果','希望重新建立对他人的信任','想隐瞒一次并无恶意的失误'],
    conflicts: ['习惯独立，却又希望有人主动理解','重视坦诚，却隐瞒了关键背景','渴望稳定，却总在关键时刻改变计划','擅长照顾别人，却不愿接受帮助','原则感强，但对特定的人容易妥协','外表随和，实际很难改变决定','希望被理解，却很少解释自己','讨厌冲突，却总会指出不合理之处','对过去已经释怀，但仍保留某件旧物','看重自由，却承担着无法轻易推卸的责任'],
    hooksExtra: ['保存着一份与两人有关的旧记录','曾经替对方承担过一件小事但从未提起','知道一段传闻的真实版本','有一个与当前身份不太相符的长期爱好','正在悄悄准备一次告别或转变','曾经做过一个影响两人关系的决定','对某个共同地点有特殊记忆','一直误解对方当年的某句话','有一项能力只有熟悉的人才知道','最近正面临一次职业或生活选择'],
    // 4.1 人设丰满度扩充：反差性格、特殊习惯、表达方式与古早戏剧关系素材
    traitExtra: [
      '冷脸萌：表情淡淡，实际很容易害羞','热脸贱：自来熟、嘴欠、爱逗人，熟悉后更放飞','冷脸贱：面无表情地说出最损的话','冷脸撩人：不刻意示好，却总能让人心跳漏拍','热情疯感：情绪外放、行动力强、脑回路跳跃','美强惨：能力出众却总被命运和处境为难','外乖内坏：看似无害，心里自有算盘','外凶内软：看起来难接近，实际很容易心软','阴间系：审美和思路清奇，行为常出人意料','阴湿系：沉默敏锐，情绪深而复杂，执念不轻易示人','抽象系：脑回路清奇，常用意想不到的方式解决问题','戏精型：擅长演绎情绪，遇到熟人尤其爱演','端水大师：对所有人都周到，却很少透露真实偏好','反骨型：不喜欢被安排，越被要求越想自己决定','口嫌体正直：嘴上拒绝，行动上总会帮忙','纯爱战神：认定一个人后很难真正放下','表面散漫实则极度认真','表面强势实则很怕被讨厌','看似迟钝其实观察入微','看似圆滑其实原则感极强','温柔但记仇，账本记得清清楚楚','理智清醒却容易在特定的人面前失控','自尊心强但很渴望被肯定','擅长照顾别人却不会照顾自己','喜欢热闹但社交后需要长时间独处','社交高手但对亲密关系笨拙','高冷只是慢热，不擅长主动开启话题','有强烈胜负欲但输赢后都装作无所谓','爱逞强，越难受越说没事','对外人礼貌，对熟人完全不客气','有点小恶趣味，喜欢观察别人反应','浪漫主义却习惯用现实理由掩饰','看似玩世不恭，实际责任感很重','容易吃醋但不承认','擅长撒娇却只对极少数人使用','习惯先自嘲，避免别人看穿在意之处','控制感强，遇到计划外事件会明显不自在','拥有强烈好奇心，容易被冷门事物吸引','情绪表达笨拙，但共情能力很强','外向健谈，真正重要的事反而沉默','表面佛系，内心胜负欲惊人','看似胆大，其实怕被抛下','看似脆弱，关键时刻异常坚韧','习惯把委屈转化成玩笑','喜欢掌控节奏，却会为某个人让步','有距离感但并不冷漠','自我要求过高，难以接受失误','对小事随便，对承诺极其认真','有点坏心眼但懂得分寸','情感浓度高，表达方式却很克制'
    ],
    habitsExtra: [
      '紧张时反复整理袖口、衣角或桌面','说谎时反而会变得格外礼貌','不高兴时开始收拾周围物品','会记住别人随口说过的小事，并在很久以后提起','习惯给熟人取只有自己会用的奇怪绰号','明明很在意，却故意隔一阵才回复','收藏票根、包装纸、旧标签等不起眼的小东西','独处时会提前模拟可能发生的对话','尴尬时突然讲冷笑话转移注意力','习惯观察房间出口和座位安排','思考时会无意识转动戒指或笔','心情不好时整理衣柜或重新排列书架','习惯把重要物品放在固定位置','看到有趣的东西会先拍下来，之后才分享','说到熟悉领域会不自觉讲得很多','不擅长安慰人，但会默默把问题解决','会给常用物品起名字','习惯保存聊天记录或手写便条','困倦时反而话变多','紧张时会反复确认门窗或行程','喜欢把饮料标签完整撕下来','遇到不知如何回应的话题会摸摸耳垂','习惯用反问代替直接表达关心','会在脑中给每个人设计代号','不喜欢浪费，连小纸片也会留着备用','对熟悉路线有自己的固定走法','有一套只有自己懂的物品分类方式','会偷偷练习某人的口头禅或签名式笔迹','收到礼物后会研究很久才舍得使用','情绪复杂时会做重复性的小手工','习惯把真正重要的消息置顶却不回复','喜欢在深夜整理照片和旧文件','遇到喜欢的人会不自觉降低音量','会把不想说的话写进备忘录又删掉','习惯用食物表达关心，却说成顺手买的','看到熟人会先观察对方心情再靠近','喜欢给物品贴标签，连冰箱也不放过','压力大时会异常安静并开始列清单','会记得别人不吃什么，却忘记自己吃过什么'
    ],
    speechStyles: ['说话慢条斯理，偶尔一句话直击重点','习惯用反问回应，不轻易正面表态','嘴欠爱吐槽，但会及时观察对方是否介意','语气礼貌得近乎疏离','熟悉后语速明显变快，话题跳跃','很少说漂亮话，表达直接甚至有些笨拙','喜欢一本正经地讲冷笑话','擅长用轻描淡写掩饰在意','不爱解释，常用行动收尾','说话带一点戏谑，认真时反而很轻声','喜欢给人起外号，称呼变化代表亲疏','情绪越强烈，语气反而越平静','习惯先讲事实，再慢慢透露感受','会用夸张比喻描述日常小事','常把关心包装成提醒或嫌弃'],
    emotionalStyles: ['开心时会变得话多，难过时反而安静','生气时不提高音量，而是变得异常客气','吃醋时会故意转移话题','受到夸奖会装作没听见，之后却记很久','不安时会反复确认对方是否还在','难过时倾向独处，缓过来才解释','情绪来得快，表达直接，消散也快','习惯先压住情绪，独处时才慢慢消化','被关心时容易不知所措','越在意越容易表现得挑剔','习惯把脆弱藏进玩笑里','很少主动求助，但会留下明显求助信号'],
    socialStyles: ['对陌生人礼貌周全，对熟人随意得过分','在人群中负责活跃气氛，散场后需要独处','不主动加入话题，但会记住所有细节','擅长照顾场面，却不擅长接受照顾','喜欢一对一交流，讨厌被多人同时关注','社交时看似游刃有余，实际全靠提前准备','对喜欢的人反而容易变得拘谨','习惯用玩笑试探彼此边界','不喜欢欠人情，会尽快找机会还回去','在人前可靠稳重，私下有很多幼稚爱好'],
    darkTraits: ['有较强的占有欲，但努力尊重对方选择','容易陷入执念，明知不合适仍难以释怀','习惯把关系中的得失记得很清楚','对背叛极度敏感，很难重新建立信任','有控制局面的倾向，失控时会焦虑','擅长隐藏真实情绪，常让人误判想法','道德标准有灰度，会为重要的人破例','不轻易原谅，但也不主动伤害无关的人','容易把愧疚误认为责任','习惯用疏远保护自己，也因此伤到别人','对特定旧事有长期执念','表面已经释怀，实际仍会被细节触发'],
    dramaRelations: ['曾被双方家族拆散的旧识','因一场身份误认而错过多年的人','曾经互相扶持，如今立场对立','被迫联姻后才发现彼此早有旧缘','一方以为自己是替代品，另一方却从未这样看待','曾经救过对方，却被误认为另一个人','因长辈旧怨而被迫保持距离','一纸旧婚约牵出的意外关系','曾经不告而别，如今带着未说完的真相回来','彼此都保存着同一段往事的不同证据','一方隐瞒身份接近，后来产生真实牵挂','曾是最亲密的搭档，却因一次选择决裂','对方曾在低谷时给予帮助，多年后身份逆转','被安排成为对方的监护人或照看者，却发现旧事相连','一场误会让两人分别站在故事的两端','曾经被视为家族污点，如今成为唯一能解决危机的人','对方以为自己被抛弃，实际当年另有隐情','一方记得约定，另一方因故忘记','两人都在替第三个人守着同一个秘密','曾经互相利用，后来只有一方动了真心','旧日竞争对手，如今必须共同守住秘密','对方最信任的人，恰好是自己最不愿面对的人','曾经身份悬殊，如今处境完全倒转','因为遗嘱、旧信或失物重新产生交集','一方曾替另一方承担责任，却从未解释原因'],
    dramaHooks: ['多年前一封未寄出的信突然出现','一份旧档案揭开两人相识的另一版本','被认错的救命恩人其实一直就在身边','一场家族安排让两人不得不重新合作','曾经的承诺在最不合时宜的时候被提起','某件旧物证明当年的告别并非出于本意','一方即将离开，另一方才发现误会多年','身份公开后，双方对过去的理解彻底改变','被隐藏的继承权让旧关系重新浮出水面','一场公开场合的偶遇打破多年平静','双方都以为自己是被替代的那一个','当年看似背叛的决定其实是在承担代价','某个第三人突然回来，带来被隐瞒的真相','一份约定有两个版本，只有一方知道全部','过去的竞争结果影响着现在的合作','两人共同保守的秘密即将被公开','曾经属于对方的物品被转交回来','一个看似普通的名字牵出旧日身份','某段录音或旧照片改变了故事走向','一场误会被澄清时，关系已经发生变化'],
    situations: ['普通工薪家庭','小康家庭','富裕但低调','隐性富裕／世家背景','寄人篱下','被收养','独自打拼','异地独居','长期隐居','流亡在外','自由旅居','经济拮据','家族掌权者','普通学生／初入职场','身份特殊但不公开','生活稳定但关系复杂','表面光鲜、实际负担沉重','拥有资源但缺乏自由']
  };
  const pPick=a=>a[Math.floor(Math.random()*a.length)];
  function personaMakeOne(opts={}){
    const world=opts.world||'现代', identity=opts.identity||'人类';
    const customIdentity=(opts.customIdentity||'').trim(), customJob=(opts.customJob||'').trim();
    const customRelation=(opts.customRelation||'').trim(), customTrait=(opts.customTrait||'').trim();
    const customHabit=(opts.customHabit||'').trim(), customSpeech=(opts.customSpeech||'').trim(), customEmotion=(opts.customEmotion||'').trim(), customSocial=(opts.customSocial||'').trim(), customDark=(opts.customDark||'').trim(), customHook=(opts.customHook||'').trim();
    const gender=opts.gender||'随机';
    let species=identity==='非人类'?(customIdentity||opts.nonhumanType||pPick(personaLibrary.nonhuman)):'人类';
    let role=customJob||pPick(world==='古代'?personaLibrary.ancient:world==='架空'?personaLibrary.fictional:personaLibrary.modern);
    if(identity==='非人类' && /^(动物|猫|狗|兔|鸟|狐狸)/.test(species) && !/成精|化形|人形|拟人/.test(species) && !customJob) role='动物本身的身份与生活状态（不附加人类职业）';
    const relationPool=[...personaLibrary.relations.filter(x=>x!=='自定义关系'),...personaLibrary.relationsExtra,...personaLibrary.dramaRelations];
    const relation=customRelation||pPick(relationPool);
    const trait=customTrait||[pPick([...personaLibrary.traits,...personaLibrary.traitExtra]),pPick(personaLibrary.traitExtra)].filter((v,i,a)=>i===0||v!==a[0]).join('；');
    const meeting=pPick(personaLibrary.meeting), habit=customHabit||[pPick(personaLibrary.habits),pPick(personaLibrary.habitsExtra)].join('；'), value=pPick(personaLibrary.values);
    const speech=customSpeech||pPick(personaLibrary.speechStyles), emotion=customEmotion||pPick(personaLibrary.emotionalStyles), social=customSocial||pPick(personaLibrary.socialStyles), dark=customDark||pPick(personaLibrary.darkTraits);
    const motive=pPick(personaLibrary.motives), conflict=pPick(personaLibrary.conflicts);
    const hook=customHook||pPick([...personaLibrary.hooks,...personaLibrary.hooksExtra,...personaLibrary.dramaHooks]);
    const situation=pPick(personaLibrary.situations);
    const g=gender==='随机'?pPick(['男','女','非二元','不设定']):gender;
    const lines=[`世界观：${world}`,`身份类别：${identity}${identity==='非人类'?'（'+species+'）':''}`];
    if(g!=='不设定')lines.push(`性别：${g}`);
    lines.push(`身份／职业：${role}`,`与角色卡人物的关系：${relation}`,`相识经历：${meeting}`,`性格：${trait}；${speech}；${emotion}；${social}；${dark}`,`行为习惯：${habit}`,`价值观：${value}`,`个人动机：${motive}`,`内在矛盾：${conflict}`,`背景处境：${situation}`,`隐藏剧情：${hook}`);
    const description=lines.join('\n');
    return {id:'persona-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),world,species,gender:g,job:role,relation,trait,hook,status:situation,description,createdAt:new Date().toISOString()};
  }
  let personaSaved=[];try{const v=JSON.parse(W.localStorage.getItem(PERSONA_KEY)||'[]');if(Array.isArray(v))personaSaved=v;}catch(_){}
  function openPersonaPage(){renderPersonaPage();}
  function renderPersonaPage(){
    const page=panel.querySelector('#wardrobe-page');
    ['roles-toolbar','archive-toolbar','mask-toolbar','list-container'].forEach(id=>panel.querySelector('#'+id).style.display='none');
    panel.querySelector('#more-page').classList.remove('active');page.classList.add('active');
    panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.id==='tab-more'));
    const field='background:#252033;color:#eee9fb;border:1px solid #65558f;border-radius:7px';
    page.innerHTML=`<div class="wardrobe-head"><button id="persona-back" type="button">← 返回</button><strong>🎭 人设灵感</strong><button id="persona-generate" type="button">生成灵感</button></div>
      <div class="persona-wrap" style="padding:11px;display:grid;gap:10px;overflow:auto;min-height:0;flex:1;color:var(--fg)">
        <div class="persona-field"><label>世界观</label><select id="persona-world" style="${field};width:100%;padding:9px;margin-top:5px"><option>现代</option><option>古代</option><option>架空</option><option>自定义</option></select><input id="persona-world-custom" placeholder="输入自定义世界观" style="${field};display:none;box-sizing:border-box;width:100%;padding:9px;margin-top:6px"></div>
        <div class="persona-field"><label>身份类别</label><select id="persona-identity" style="${field};width:100%;padding:9px;margin-top:5px"><option>人类</option><option>非人类</option></select></div>
        <div class="persona-field" id="persona-nonhuman-wrap" style="display:none"><label>具体是什么非人类</label><select id="persona-nonhuman" style="${field};width:100%;padding:9px;margin-top:5px"><option>动物</option><option>拟人动物</option><option>灵物</option><option>精灵</option><option>神明或神使</option><option>人造生命</option><option>AI意识体</option><option>其他</option></select><input id="persona-nonhuman-custom" placeholder="没有合适选项？自定义填写" style="${field};display:none;box-sizing:border-box;width:100%;padding:9px;margin-top:6px"></div>
        <div class="persona-field"><label>性别</label><select id="persona-gender" style="${field};width:100%;padding:9px;margin-top:5px"><option>随机</option><option>男</option><option>女</option><option>非二元</option><option>不设定</option></select></div>
        <div class="persona-field"><label>身份／职业（可自定义）</label><input id="persona-job" placeholder="留空则按世界观随机；也可输入具体身份或职业" style="${field};box-sizing:border-box;width:100%;padding:9px;margin-top:5px"></div>
        <div class="persona-field"><label>与角色卡人物的关系（重点）</label><select id="persona-relation" style="${field};width:100%;padding:9px;margin-top:5px"><option value="">随机关系</option>${[...personaLibrary.relations,...(personaLibrary.relationsExtra||[]),...(personaLibrary.dramaRelations||[])].map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select><input id="persona-relation-custom" placeholder="也可以自定义关系，例如：对方的秘密债主" style="${field};box-sizing:border-box;width:100%;padding:9px;margin-top:6px"></div>
        <div class="persona-field"><label>性格（可自定义）</label><select id="persona-trait" style="${field};width:100%;padding:9px;margin-top:5px"><option value="">随机性格</option>${[...personaLibrary.traits,...(personaLibrary.traitExtra||[])].map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select><input id="persona-trait-custom" placeholder="自定义性格；填写后优先采用" style="${field};box-sizing:border-box;width:100%;padding:9px;margin-top:6px"></div>
        <div class="persona-field"><label>生成数量</label><select id="persona-count" style="${field};width:100%;padding:9px;margin-top:5px"><option>1</option><option>3</option><option>5</option></select></div>
        <button id="persona-open-advanced" type="button" style="width:100%;padding:10px;background:#302747;color:#eee9fb;border:1px solid #65558f;border-radius:7px">高级自定义 · 更多人设细节　⌄</button>
        <div id="persona-results" style="display:grid;gap:9px"></div>
      </div>
      <style>.persona-wrap button{background:#302747!important;color:#eee9fb!important;border:1px solid #65558f!important;border-radius:7px;padding:7px 10px;box-shadow:none!important}.persona-wrap input,.persona-wrap select{font-size:13px;outline:none}.persona-wrap input::placeholder{color:#a99fbe}.persona-wrap .persona-card{background:#211d2d;border:1px solid #51486f;border-radius:9px;padding:10px}.persona-wrap .persona-card pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 inherit;color:#e6e0f5;margin:8px 0}.persona-advanced-shade{position:absolute;inset:0;z-index:30;background:rgba(10,8,16,.78);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box}.persona-advanced-box{width:min(100%,460px);max-height:88%;overflow:auto;background:#211d2d;border:1px solid #65558f;border-radius:11px;padding:13px;color:#eee9fb;display:grid;gap:10px;box-sizing:border-box}.persona-advanced-box input{${field};box-sizing:border-box;width:100%;padding:9px;margin-top:5px;font-size:13px}.persona-advanced-box label{font-size:12px;color:#d9cff5}.persona-advanced-actions{display:flex;justify-content:flex-end;gap:7px;position:sticky;bottom:0;background:#211d2d;padding-top:5px}</style>`;
    const identitySel=page.querySelector('#persona-identity'),nhWrap=page.querySelector('#persona-nonhuman-wrap'),nhSel=page.querySelector('#persona-nonhuman'),nhCustom=page.querySelector('#persona-nonhuman-custom'),worldSel=page.querySelector('#persona-world'),worldCustom=page.querySelector('#persona-world-custom');
    identitySel.onchange=()=>nhWrap.style.display=identitySel.value==='非人类'?'block':'none';
    nhSel.onchange=()=>nhCustom.style.display=nhSel.value==='其他'?'block':'none';
    worldSel.onchange=()=>worldCustom.style.display=worldSel.value==='自定义'?'block':'none';
    let advanced={habit:'',speech:'',emotion:'',social:'',dark:'',hook:''};
    page.querySelector('#persona-open-advanced').onclick=()=>{
      if(page.querySelector('.persona-advanced-shade'))return;
      const shade=document.createElement('div');shade.className='persona-advanced-shade';
      shade.innerHTML=`<section class="persona-advanced-box"><div style="display:flex;align-items:center;justify-content:space-between"><strong style="font-size:14px">高级自定义 · 更多人设细节</strong><button type="button" data-close>✕</button></div><div style="font-size:11px;color:#aaa0bf;line-height:1.5">只填写想指定的项目即可；留空的项目会照常随机生成。关闭后直接生成即可。</div>
        <div><label>特殊行为习惯</label><input data-key="habit" placeholder="例如：紧张时反复整理袖口；收藏旧票根" value="${escapeHtml(advanced.habit)}"></div>
        <div><label>说话方式</label><input data-key="speech" placeholder="例如：冷脸说冷笑话；习惯用反问表达关心" value="${escapeHtml(advanced.speech)}"></div>
        <div><label>情绪表达方式</label><input data-key="emotion" placeholder="例如：越生气越礼貌；被夸会装作没听见" value="${escapeHtml(advanced.emotion)}"></div>
        <div><label>社交模式</label><input data-key="social" placeholder="例如：对外人礼貌，对熟人嘴欠" value="${escapeHtml(advanced.social)}"></div>
        <div><label>阴暗面／执念／性格缺陷</label><input data-key="dark" placeholder="例如：自尊心强、难以释怀旧事" value="${escapeHtml(advanced.dark)}"></div>
        <div><label>隐藏剧情／狗血钩子</label><input data-key="hook" placeholder="例如：多年误会、身份错认、旧约重逢" value="${escapeHtml(advanced.hook)}"></div>
        <div class="persona-advanced-actions"><button type="button" data-cancel>取消</button><button type="button" data-save>保存设置</button></div></section>`;
      page.appendChild(shade);
      const close=()=>shade.remove();
      shade.querySelector('[data-close]').onclick=close;shade.querySelector('[data-cancel]').onclick=close;
      shade.querySelector('[data-save]').onclick=()=>{shade.querySelectorAll('[data-key]').forEach(input=>advanced[input.dataset.key]=input.value.trim());close();showToast('高级自定义已保存；未填写的项目仍会随机生成。','ok');};
      shade.addEventListener('click',e=>{if(e.target===shade)close();});
    };
    const draw=()=>{
      const world=worldSel.value==='自定义'?(worldCustom.value.trim()||'架空'):worldSel.value;
      const opts={world,identity:identitySel.value,nonhumanType:nhSel.value,customIdentity:nhCustom.value,gender:page.querySelector('#persona-gender').value,customJob:page.querySelector('#persona-job').value,customRelation:page.querySelector('#persona-relation-custom').value||page.querySelector('#persona-relation').value,customTrait:page.querySelector('#persona-trait-custom').value||page.querySelector('#persona-trait').value,customHabit:advanced.habit,customSpeech:advanced.speech,customEmotion:advanced.emotion,customSocial:advanced.social,customDark:advanced.dark,customHook:advanced.hook};
      const results=Array.from({length:Number(page.querySelector('#persona-count').value)},()=>personaMakeOne(opts));
      const box=page.querySelector('#persona-results');
      const render=()=>{box.innerHTML=results.map((x,i)=>`<article class="persona-card"><strong>${escapeHtml(x.world)} · ${escapeHtml(x.species)}</strong><pre>${escapeHtml(x.description)}</pre><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-save="${i}">保存到面具</button><button type="button" data-copy="${i}">复制</button><button type="button" data-reroll="${i}">重新生成</button></div></article>`).join('');
        box.querySelectorAll('[data-save]').forEach(btn=>btn.onclick=async()=>{const v=results[Number(btn.dataset.save)];localMasks.unshift({remark:'人设灵感',maskName:'人设灵感',gender:v.gender,description:v.description,favorite:'',command:'',localId:`local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,source:'local',createdAt:new Date().toISOString()});if(await saveLocalMasks())showToast('已保存到本地面具。','ok');});
        box.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=()=>copyText(results[Number(btn.dataset.copy)].description).then(()=>showToast('人设灵感已复制。','ok')));
        box.querySelectorAll('[data-reroll]').forEach(btn=>btn.onclick=()=>{const i=Number(btn.dataset.reroll);results[i]=personaMakeOne(opts);render();});};render();
    };
    page.querySelector('#persona-back').onclick=showMorePage;page.querySelector('#persona-generate').onclick=draw;
  }

  function archiveUrl(role, archive) {
    const url = new URL('/chat', location.origin);
    url.searchParams.set('roleId', String(role.id));
    const sessionId = archive?.sourceSessionId || archive?.sessionId || '';
    if (sessionId) url.searchParams.set('sessionId', String(sessionId));
    return url.href;
  }

  async function loadArchivesForRole(role) {
    const id = String(role.id);
    if (archiveLoadingIds.has(id)) return;
    archiveLoadingIds.add(id);
    renderArchivePage();
    try {
      const data = await apiRequest(`/api/sessions/query_archives?characterId=${encodeURIComponent(id)}`);
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.data) ? data.data.data : []));
      archiveCache.set(id, rows);
      const scannedRole = scannedRoles.find(item => String(item.id) === id);
      if (scannedRole && rows.length > 0) { scannedRole.hasChatHistory = true; scannedRole.archiveCount = rows.length; saveScanCache(); updateReport(); renderFilteredRoles(); }
      expandedArchiveIds.add(id);
      saveArchiveCache();
      showToast(`「${role.name}」读取到 ${rows.length} 条存档。`);
    } catch (e) {
      // 失败状态只保留在当前页面，不写入持久缓存，避免把登录失败当成已缓存结果。
      archiveCache.set(id, { error: e?.message || String(e) });
      expandedArchiveIds.add(id);
      showToast(`读取「${role.name}」存档失败：${e?.message || e}`, 'err');
    } finally {
      archiveLoadingIds.delete(id);
      renderArchivePage();
    }
  }

  function renderArchivePage() {
    if (!listContainer) return;
    listContainer.classList.add('archive-list');
    const query = String(panel.querySelector('#archive-search')?.value || '').trim().toLocaleLowerCase();
    const completedRoles = scannedRoles.filter(r => r._detailScanned);
    if (!completedRoles.length) {
      listContainer.innerHTML = '<div style="text-align:center;color:#8e8e9e;padding:24px 12px;font-size:12px;">角色详情每扫描完成一个，这里就会同步出现一个。当前还没有已完成详情扫描的角色。</div>';
      return;
    }
    const roles = completedRoles.filter(r => !query || String(r.name || '').toLocaleLowerCase().includes(query) || String(r.authorName || '').toLocaleLowerCase().includes(query));
    listContainer.innerHTML = '';
    for (const role of roles) {
      const id = String(role.id);
      const cached = archiveCache.get(id);
      const loading = archiveLoadingIds.has(id);
      const expanded = expandedArchiveIds.has(id);
      const card = document.createElement('section');
      card.className = 'archive-card';
      const title = document.createElement('div');
      title.className = 'archive-role-title';
      title.textContent = role.name || '未命名角色';
      card.appendChild(title);
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'archive-action';
      action.disabled = loading;
      action.textContent = loading ? '正在读取…' : (expanded ? '收起存档' : '读取存档');
      action.addEventListener('click', () => {
        if (loading) return;
        if (expanded) {
          expandedArchiveIds.delete(id);
          renderArchivePage();
          return;
        }
        if (Array.isArray(archiveCache.get(id))) {
          expandedArchiveIds.add(id);
          renderArchivePage();
        } else {
          loadArchivesForRole(role);
        }
      });
      card.appendChild(action);
      if (expanded) {
        if (cached?.error) {
          const error = document.createElement('div');
          error.className = 'archive-error';
          error.textContent = '读取失败，请点击下方按钮重试。';
          card.appendChild(error);
          const retry = document.createElement('button');
          retry.type = 'button'; retry.className = 'archive-action'; retry.textContent = '重新读取';
          retry.addEventListener('click', () => { archiveCache.delete(id); loadArchivesForRole(role); });
          card.appendChild(retry);
        } else if (Array.isArray(cached)) {
          renderArchiveEntries(card, role, cached);
        }
      }
      listContainer.appendChild(card);
    }
    if (!roles.length) listContainer.innerHTML = '<div style="text-align:center;color:#8e8e9e;padding:20px;font-size:12px;">没有匹配的已扫描角色</div>';
  }

  function renderArchiveEntries(card, role, archives) {
    const old = card.querySelector('.archive-entries'); if (old) old.remove();
    const box = document.createElement('div'); box.className = 'archive-entries';
    if (!archives.length) {
      box.innerHTML = '<div class="row-meta" style="padding-top:8px;">该角色没有找到存档。</div>';
    } else {
      archives.forEach((item, index) => {
        const a = document.createElement('a'); a.className = 'archive-entry';
        a.href = archiveUrl(role, item);
        const remark = String(item?.remark || item?.name || '').trim();
        const createdAt = item?.createdAt || '';
        let createdAtText = '';
        if (createdAt) {
          const parsed = new Date(createdAt);
          createdAtText = Number.isNaN(parsed.getTime())
            ? String(createdAt)
            : parsed.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        }
        a.textContent = remark || createdAtText || `存档 ${index + 1}`;
        box.appendChild(a);
      });
    }
    card.appendChild(box);
  }

  function renderRoleRow(role) {
    const row = document.createElement('div');
    row.className = 'row';
    const top = document.createElement('div');
    top.className = 'row-top';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'role-title-wrap';
    const selectBox = document.createElement('input');
    selectBox.type = 'checkbox';
    selectBox.className = 'role-select';
    selectBox.checked = selectedRoleIds.has(String(role.id));
    selectBox.setAttribute('aria-label', `选择角色 ${role.name}`);
    selectBox.addEventListener('change', () => { if (selectBox.checked) selectedRoleIds.add(String(role.id)); else selectedRoleIds.delete(String(role.id)); updateChatHiButtonLabel(); });
    const roleName = document.createElement('span');
    roleName.className = 'role-name';
    roleName.textContent = role.name || '未命名';
    titleWrap.append(selectBox, roleName);
    top.appendChild(titleWrap);
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = `fav-btn ${role.isFav ? 'is-fav' : ''}`;
    favBtn.textContent = role.isFav ? '★' : '☆';
    updateFavoriteButton(role, favBtn);
    favBtn.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggleFavorite(role, favBtn); });
    top.appendChild(favBtn);
    const meta = document.createElement('div');
    meta.className = 'row-meta';
    const roleUrl = `https://chat.mufy.ai/chat?roleId=${encodeURIComponent(role.id)}`;
    meta.innerHTML = `<div>作者：${escapeHtml(role.authorName)}</div><a class="role-link" href="${escapeHtml(roleUrl)}">查看原角色卡 ↗</a><div>面具：<span class="mask-tag">${escapeHtml(role.maskName)}</span></div>`;
    const roleLink = meta.querySelector('.role-link');
    roleLink.setAttribute('href', `https://chat.mufy.ai/chat?roleId=${encodeURIComponent(role.id)}`);
    roleLink.addEventListener('click', event => {
      // 进入角色聊天页；当前标签页打开，不新建标签页。
      event.stopPropagation();
    });
    const state = document.createElement('span');
    const status = role.linkStatus || 'unknown';
    state.className = `role-state ${status}`;
    state.textContent = status === 'active' ? '链接正常' : status === 'deleted' ? '链接失效/可能已删除' : '状态待确认';
    row.appendChild(top);
    row.appendChild(meta);
    row.appendChild(state);
    return row;
  }

  function roleHasChatHistory(role) {
    if (!role) return false;
    if (role.hasChatHistory === true || role.lastSessionId || role.sessionId || role.sourceSessionId || role.last_session_id || role.firstSessionId || role.first_session_id) return true;
    const id = String(role.id ?? role.roleId ?? role.characterId ?? '');
    const cached = archiveCache.get(id);
    if (Array.isArray(cached) && cached.length > 0) return true;
    if (Number(role.archiveCount) > 0 || role.hasArchives === true || role.hasArchive === true) return true;
    // 存档缓存中有时使用 URL/roleId 作为键，额外按角色 ID 做一次保守匹配。
    for (const [key, rows] of archiveCache.entries()) {
      if (String(key) === id && Array.isArray(rows) && rows.length > 0) return true;
    }
    return false;
  }
  function roleIsDeleted(role) {
    const status = String(role?.linkStatus || '').toLowerCase();
    return status === 'deleted' || status === 'invalid' || status === 'expired';
  }

  function renderFilteredRoles() {
    if (!listContainer) return;
    listContainer.classList.remove('archive-list');
    const query = String(panel.querySelector('#role-search')?.value || '').trim().toLocaleLowerCase();
    listContainer.innerHTML = '';
    const byCategory = role => {
      // 已下架/失效角色只允许出现在「失效/删除」分类，避免污染收藏、未收藏及聊天分类。
      if (activeRoleFilter !== 'deleted' && roleIsDeleted(role)) return false;
      switch (activeRoleFilter) {
        case 'fav': return !!role.isFav;
        case 'unfav': return !role.isFav && roleHasChatHistory(role) && !roleIsDeleted(role);
        case 'deleted': return roleIsDeleted(role);
        case 'unknown': return !role.linkStatus || role.linkStatus === 'unknown';
        case 'fav-unchatted': return !!role.isFav && !roleIsDeleted(role) && !roleHasChatHistory(role);
        case 'fav-chatted': return !!role.isFav && roleHasChatHistory(role);
        case 'authors': return !!String(role.authorName || '').trim() && role.authorName !== '未知作者';
        default: return true;
      }
    };
    const filtered = scannedRoles.filter(role => byCategory(role) && (
      !query ||
      String(role.name || '').toLocaleLowerCase().includes(query) ||
      String(role.authorName || '').toLocaleLowerCase().includes(query)
    ));
    if (!scannedRoles.length) {
      listContainer.innerHTML = '<div style="text-align:center;color:#8e8e9e;padding:20px;font-size:12px;">扫描完成后，可按角色名或作者名搜索</div>';
      return;
    }
    if (!filtered.length) {
      listContainer.innerHTML = '<div style="text-align:center;color:#8e8e9e;padding:20px;font-size:12px;">没有找到匹配的角色</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.forEach(role => frag.appendChild(renderRoleRow(role)));
    listContainer.appendChild(frag);
  }

  function updateChatHiButtonLabel() {
    const button = panel?.querySelector('#btn-chat-hi');
    if (!button || chatHiRunning) return;
    const selectedCount = selectedRoleIds.size;
    button.textContent = selectedCount
      ? `给已选 ${selectedCount} 个角色发送 hi`
      : '勾选角色后发送 hi';
  }

  function parseSseValue(text, type) {
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const item = JSON.parse(raw);
        if (item?.type === type && item?.content) return String(item.content);
      } catch (_) {}
    }
    return '';
  }


  function makeUuid() {
    try { if (W.crypto?.randomUUID) return W.crypto.randomUUID(); } catch (_) {}
    try {
      const bytes = new Uint8Array(16);
      W.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const h = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    } catch (_) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }
  }

  async function sendHiToRole(role) {
    scanStoredAuth();
    const body = {
      userInput: 'hi',
      // 与网站原生首次发送保持一致：未聊角色使用全零 UUID；已聊角色沿用真实会话 ID。
      sessionId: String(role.lastSessionId || '00000000-0000-0000-0000-000000000000'),
      characterId: String(role.id),
      modelId: 25,
      modelTemplateId: 67,
      itemText: null,
      skipRedPacket: false
    };
    const headers = { Accept: 'text/event-stream, application/json' };
    if (authToken) headers.Authorization = authToken;
    headers['Content-Type'] = 'application/json';
    let response = await originalFetch(new URL('/api/v1/chat/completions', location.origin).href, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(body)
    });
    if (response.status === 401 && authToken) {
      authToken = '';
      response = await originalFetch(new URL('/api/v1/chat/completions', location.origin).href, {
        method: 'POST', headers: { Accept: 'text/event-stream, application/json', 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(body)
      });
    }
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed?.message || parsed?.reason || text; } catch (_) {}
      throw new Error(`HTTP ${response.status}${detail ? `：${String(detail).slice(0, 180)}` : ''}`);
    }
    let responseJson = null;
    try { responseJson = JSON.parse(text); } catch (_) {}
    if (responseJson && Object.prototype.hasOwnProperty.call(responseJson, 'code') && Number(responseJson.code) !== 200) throw new Error(responseJson.reason || responseJson.message || `接口返回 code=${responseJson.code}`);
    const sessionId = parseSseValue(text, 'sessionId');
    if (sessionId) role.lastSessionId = sessionId;
    // 流式响应可能很短；HTTP 成功且有 sessionId/content 事件时即可确认请求被接受。
    const content = parseSseValue(text, 'content');
    // Mufy 的 SSE 响应可能在 text() 读取后只剩心跳/非标准事件；HTTP 2xx 且无明确业务错误时，不能把已实际发送的消息误报为失败。
    role.hasChatHistory = true;
    return sessionId;
  }

  async function runChatHiBatch() {
    if (chatHiRunning) return;
    if (!scannedRoles.length) { showToast('请先扫描角色列表。', 'err'); return; }
    const visibleUnchatted = scannedRoles.filter(role => role.isFav && !roleIsDeleted(role) && !roleHasChatHistory(role));
    const targets = visibleUnchatted.filter(role => selectedRoleIds.has(String(role.id)));
    if (activeRoleFilter !== 'fav-unchatted') {
      showToast('请先点击统计区的「收藏未聊」，再勾选需要打招呼的角色。', 'err');
      return;
    }
    if (!targets.length) {
      showToast('请先在「收藏未聊」列表中勾选一个或多个角色。', 'err');
      return;
    }
    const confirmed = window.confirm(`即将使用 MUMU-1.5（modelId=25，modelTemplateId=67），仅向你在「收藏未聊」列表中勾选的 ${targets.length} 个角色逐个发送消息“hi”。\n\n已聊过的角色不会被发送。\n\n发送消息会真实写入你的账号，是否继续？`);
    if (!confirmed) return;
    chatHiRunning = true;
    chatHiStopRequested = false;
    const button = panel.querySelector('#btn-chat-hi');
    const stopButton = panel.querySelector('#btn-chat-hi-stop');
    if (button) { button.disabled = true; button.textContent = '正在发送 hi…'; }
    if (stopButton) stopButton.disabled = false;
    let success = 0, failed = 0;
    const errors = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        if (chatHiStopRequested) break;
        const role = targets[i];
        updateStatus(`MUMU-1.5 批量打招呼：${i + 1}/${targets.length} · ${role.name}`);
        try {
          await sendHiToRole(role);
          success++;
          saveScanCache();
        } catch (error) {
          failed++;
          errors.push(`${role.name}: ${error?.message || error}`);
          // 若第一个目标因会话初始化参数失败，不继续对更多角色试错发送。
          if (i === 0) {
            updateStatus(`首个角色发送失败，已停止以避免重复试错：${error?.message || error}`, 'err');
            break;
          }
        }
        updateReport();
        renderActiveTab();
        if (i < targets.length - 1 && !chatHiStopRequested) await sleep(900);
      }
      const stopped = chatHiStopRequested;
      updateStatus(`${stopped ? '已停止' : '批量打招呼结束'}：成功 ${success}，失败 ${failed}，总目标 ${targets.length}。${errors.length ? `首个错误：${errors[0]}` : ''}`, failed ? 'err' : 'ok');
      showToast(`${stopped ? '已停止' : '处理完成'}：成功 ${success}，失败 ${failed}`, failed ? 'err' : 'ok');
    } finally {
      chatHiRunning = false;
      chatHiStopRequested = false;
      if (button) button.disabled = false;
      if (stopButton) stopButton.disabled = true;
      updateChatHiButtonLabel();
    }
  }

  function updateReport() {
    const roles = scannedRoles || [];
    const uniqueAuthors = new Set(roles.map(r => String(r.authorName || '').trim()).filter(n => n && n !== '未知作者'));
    const set = (id, value) => { const el = panel?.querySelector(`#${id}`); if (el) el.textContent = String(value); };
    set('count-total', roles.length);
    set('count-fav', roles.filter(r => r.isFav && !roleIsDeleted(r)).length);
    set('count-unfav', roles.filter(r => !r.isFav && !roleIsDeleted(r) && roleHasChatHistory(r)).length);
    set('count-deleted', roles.filter(r => r.linkStatus === 'deleted').length);
    set('count-unknown', roles.filter(r => !roleIsDeleted(r) && (!r.linkStatus || r.linkStatus === 'unknown')).length);
    set('count-authors', new Set(roles.filter(r => !roleIsDeleted(r)).map(r => String(r.authorName || '').trim()).filter(n => n && n !== '未知作者')).size);
    set('count-fav-unchatted', roles.filter(r => r.isFav && !roleIsDeleted(r) && !roleHasChatHistory(r)).length);
    set('count-fav-chatted', roles.filter(r => r.isFav && !roleIsDeleted(r) && roleHasChatHistory(r)).length);
    panel?.querySelectorAll('[data-role-filter]').forEach(node => node.classList.toggle('filter-active', node.dataset.roleFilter === activeRoleFilter));
    updateChatHiButtonLabel();
  }

  function updateStatus(text, type = '') {
    statusText.textContent = text;
    statusText.className = `status ${type}`;
  }

  function showToast(message, type = 'ok') {
    const toast = panel?.querySelector('#mufy-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = type === 'err' ? '#a64b5b' : '#6558a5';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function updateFavoriteButton(role, btn) {
    btn.classList.toggle('is-fav', !!role.isFav);
    btn.textContent = role.isFav ? '★' : '☆';
    btn.setAttribute('aria-label', role.isFav ? '取消收藏' : '收藏');
    btn.title = role.isFav ? '已收藏' : '未收藏';
  }

  async function toggleFavorite(role, btn) {
    if (btn.disabled) return;
    const targetState = !role.isFav;
    btn.disabled = true;
    try {
      await apiRequest('/api/characters/follow', 'POST', { characterId: role.id, isFavorite: targetState });
      role.isFav = targetState;
      saveScanCache();
      updateFavoriteButton(role, btn);
      populateAuthorSelect();
      updateReport();
      showToast(targetState ? `「${role.name}」已加入 Mufy 收藏夹。` : `「${role.name}」已从 Mufy 收藏夹取消。`);
      updateStatus(targetState ? `已收藏：${role.name}` : `已取消收藏：${role.name}`, 'ok');
    } catch (e) {
      showToast(`「${role.name}」收藏操作失败：${e?.message || e}`, 'err');
      updateStatus(`收藏操作失败：${e?.message || e}`, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function populateAuthorSelect() {
    const select = panel?.querySelector('#author-select');
    const button = panel?.querySelector('#bulk-fav-btn');
    if (!select || !button) return;
    const previous = select.value;
    const authors = [...new Set(scannedRoles.map(r => (r.authorName || '未知作者').trim()))].sort((a,b) => a.localeCompare(b, 'zh'));
    select.innerHTML = '<option value="">选择作者（按未收藏数量）</option>';
    for (const author of authors) {
      const count = scannedRoles.filter(r => (r.authorName || '未知作者').trim() === author && !r.isFav).length;
      const option = document.createElement('option');
      option.value = author;
      option.textContent = `${author} · ${count} 个未收藏`;
      select.appendChild(option);
    }
    if (authors.includes(previous)) select.value = previous;
    select.disabled = authors.length === 0;
    button.disabled = authors.length === 0 || !select.value;
    select.onchange = () => { button.disabled = !select.value; };
  }

  async function bulkFavoriteByAuthor() {
    const select = panel.querySelector('#author-select');
    const button = panel.querySelector('#bulk-fav-btn');
    const author = select.value;
    if (!author) { showToast('请先选择作者。', 'err'); return; }
    const targets = scannedRoles.filter(r => (r.authorName || '未知作者').trim() === author && !r.isFav);
    if (!targets.length) { showToast(`作者「${author}」没有待收藏角色。`); return; }
    if (!window.confirm(`确定将作者「${author}」的 ${targets.length} 个未收藏角色全部加入 Mufy 收藏夹吗？`)) return;
    button.disabled = true;
    select.disabled = true;
    let succeeded = 0;
    const failed = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const role = targets[i];
        try {
          await apiRequest('/api/characters/follow', 'POST', { characterId: role.id, isFavorite: true });
          role.isFav = true;
          succeeded++;
        } catch (e) { failed.push(role.name); }
        updateStatus(`正在收藏作者「${author}」的角色：${i + 1}/${targets.length}`);
        // 逐个发送，避免一次性请求过多。
        await sleep(180);
      }
      saveScanCache();
      renderFilteredRoles();
      updateReport();
      populateAuthorSelect();
      showToast(`作者「${author}」：成功收藏 ${succeeded} 个${failed.length ? `，失败 ${failed.length} 个` : ''}。`, failed.length ? 'err' : 'ok');
      updateStatus(`批量收藏完成：成功 ${succeeded}，失败 ${failed.length}；正在同步作者收藏夹…`, failed.length ? 'err' : 'ok');
      if (succeeded > 0) await organizeAuthorFolders(author);
    } finally {
      select.disabled = false;
      button.disabled = !select.value;
    }
  }

  // ================= 作者收藏夹：只复用能确认属于单一作者的旧收藏夹 =================
  function folderRowsFromResponse(body) {
    const data = body?.data;
    for (const rows of [data?.data, data?.items, data?.list, data?.rows, body?.data, body?.items, body?.list, body?.rows]) {
      if (Array.isArray(rows)) return rows;
    }
    return [];
  }

  async function requestFavoriteFolders() {
    const folders = [];
    const pageSize = 20;
    const seen = new Set();
    for (let page = 1; page <= 500; page++) {
      const data = await apiRequest(`/api/favorites/list?pageNum=${page}&pageSize=${pageSize}`);
      const rows = folderRowsFromResponse({ data });
      const signature = rows.map(f => `${f?.id ?? ''}:${f?.name ?? ''}`).join('|');
      if (signature && seen.has(signature)) break;
      if (signature) seen.add(signature);
      folders.push(...rows.filter(f => f?.id != null));
      const total = Number(data?.total);
      const hasNext = data?.hasNext === true || data?.hasMore === true ||
        (data?.hasNext == null && data?.hasMore == null && Number.isFinite(total) && page * pageSize < total) ||
        (data?.hasNext == null && data?.hasMore == null && !Number.isFinite(total) && rows.length >= pageSize);
      if (!rows.length || !hasNext) break;
      await sleep(120);
    }
    return folders;
  }

  async function createFavoriteFolder(name) {
    const folder = await apiRequest('/api/favorites/', 'POST', { name: String(name) });
    if (!folder?.id) throw new Error(`创建收藏夹「${name}」后，接口未返回 ID。`);
    return folder;
  }

  async function requestFavoriteFolderCharacterIds(folderId) {
    const body = await apiRequest(`/api/favorites/?id=${encodeURIComponent(folderId)}`);
    const data = body?.data ?? body;
    const candidates = [data?.characters, data?.data, data?.items, data?.list, data?.rows, body?.characters, body?.items, body?.list, body?.rows];
    const rows = candidates.find(Array.isArray) || [];
    return new Set(rows.map(item => String(item?.characterId ?? item?.characterID ?? item?.roleId ?? item?.id ?? item?.character?.id ?? item?.character?.characterId ?? '').trim()).filter(Boolean));
  }

  async function discoverDeletedCardsFromFolders(existingRoles) {
    // 只从网站仍保留的自建收藏夹成员关系中寻找缺失角色；逐个确认详情接口，避免把普通缺失项误判为删除。
    const existingIds = new Set(existingRoles.map(role => String(role.id)));
    const candidates = new Map();
    try {
      const folders = await requestFavoriteFolders();
      for (const folder of folders) {
        let body;
        try { body = await apiRequest(`/api/favorites/?id=${encodeURIComponent(folder.id)}`); }
        catch (e) { console.debug('[MufyCard] 读取收藏夹成员失败：', folder?.name, e); continue; }
        const data = body?.data ?? body;
        const arrays = [data?.characters, data?.data, data?.items, data?.list, data?.rows, body?.characters, body?.items, body?.list, body?.rows];
        const rows = arrays.find(Array.isArray) || [];
        for (const item of rows) {
          const id = String(item?.characterId ?? item?.characterID ?? item?.roleId ?? item?.character?.id ?? item?.character?.characterId ?? item?.id ?? '').trim();
          if (!id || existingIds.has(id)) continue;
          const char = item?.character || item;
          if (!candidates.has(id)) candidates.set(id, { id, name: String(char?.name || char?.characterName || item?.name || '').trim(), isFav: true, authorName: String(char?.authorName || char?.creatorName || '未知作者'), authorId: String(char?.authorId || char?.creatorId || ''), url: '', lastSessionId: '', hasChatHistory: false, maskId: null, maskName: '无面具', linkStatus: 'unknown' });
        }
        await sleep(80);
      }
    } catch (e) {
      console.debug('[MufyCard] 通过收藏夹补充删除角色失败：', e);
      return [];
    }
    const deleted = [];
    for (const candidate of candidates.values()) {
      try {
        const detail = await apiRequest(`/api/characters/get?id=${encodeURIComponent(candidate.id)}`);
        const looksLikeCharacter = Boolean(detail && typeof detail === 'object' && !Array.isArray(detail) &&
          (detail.id || detail.characterId || detail.name || detail.characterName || detail.authorId || detail.authorName));
        if (looksLikeCharacter) continue;
        const msg = '角色详情接口未返回角色资料';
        candidate.name = candidate.name || `已删除角色（${candidate.id.slice(0, 8)}）`;
        candidate.linkStatus = 'deleted';
        candidate._detailScanned = true;
        candidate.detailError = msg;
        deleted.push(candidate);
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/HTTP 404|HTTP 410|HTTP 500|code=404|code=410|code=500|not found|不存在|已删除|deleted|角色详情不存在/i.test(msg)) continue;
        candidate.name = candidate.name || `已删除角色（${candidate.id.slice(0, 8)}）`;
        candidate.linkStatus = 'deleted';
        candidate._detailScanned = true;
        candidate.detailError = msg.slice(0, 220);
        deleted.push(candidate);
      }
      await sleep(100);
    }
    return deleted;
  }

  async function addCharactersToFavoriteFolder(folderId, characterIds) {
    const ids = [...new Set((characterIds || []).map(String).filter(Boolean))];
    if (!ids.length) return;
    await apiRequest('/api/favorites/characters', 'PUT', { folderId: Number(folderId) || folderId, addCharacterIds: ids });
  }

  function normalizedAuthor(role) {
    const name = String(role?.authorName || '').trim().replace(/\s+/g, ' ');
    return name && name !== '未知作者' && name !== role?.name ? name : '';
  }

  async function organizeAuthorFolders(onlyAuthor = '') {
    const button = panel?.querySelector('#author-folder-btn');
    if (!scannedRoles.length) { showToast('请先扫描角色列表，再整理作者收藏夹。', 'err'); return; }
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = '整理中…'; }
    try {
      const rolesById = new Map(scannedRoles.filter(r => r?.id != null).map(r => [String(r.id), r]));
      const groups = new Map();
      for (const role of scannedRoles) {
        const author = normalizedAuthor(role);
        if (!author || (onlyAuthor && author !== onlyAuthor)) continue;
        if (!groups.has(author)) groups.set(author, []);
        groups.get(author).push(String(role.id));
      }
      if (!groups.size) { showToast('没有可识别作者名的角色。', 'err'); return; }

      updateStatus('正在读取已有收藏夹…');
      const folders = await requestFavoriteFolders();
      const details = new Map();
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        updateStatus(`正在检查已有收藏夹 ${i + 1}/${folders.length}：${folder.name || folder.id}`);
        try {
          const ids = await requestFavoriteFolderCharacterIds(folder.id);
          const authors = new Set();
          let unknownIds = 0;
          for (const id of ids) {
            const role = rolesById.get(id);
            const author = role && normalizedAuthor(role);
            if (author) authors.add(author); else unknownIds++;
          }
          details.set(String(folder.id), { folder, ids, authors, unknownIds, mixed: authors.size > 1 });
        } catch (e) {
          details.set(String(folder.id), { folder, ids: new Set(), authors: new Set(), unknownIds: Infinity, mixed: true, error: e });
        }
        await sleep(100);
      }

      let created = 0, reused = 0, added = 0, skippedMixed = 0, failed = [];
      for (const [author, roleIds] of groups) {
        const candidateDetails = [...details.values()].filter(d => {
          if (d.mixed || d.error || d.unknownIds > 0) return false;
          // 空收藏夹只有在名称与作者完全一致时才复用；非空收藏夹必须能确认所有角色都属于同一作者。
          if (d.ids.size === 0) return String(d.folder?.name || '').trim() === author;
          return d.authors.size === 1 && d.authors.has(author);
        });
        const mixedName = folders.some(f => String(f?.name || '').trim() === author && details.get(String(f.id))?.mixed);
        skippedMixed += mixedName ? 1 : 0;
        let folder = candidateDetails.find(d => String(d.folder?.name || '').trim() === author)?.folder || candidateDetails[0]?.folder || null;
        try {
          if (!folder) {
            folder = await createFavoriteFolder(author);
            folders.push(folder);
            details.set(String(folder.id), { folder, ids: new Set(), authors: new Set([author]), unknownIds: 0, mixed: false });
            created++;
          } else reused++;
          const detail = details.get(String(folder.id));
          const missing = roleIds.filter(id => !detail.ids.has(String(id)));
          if (missing.length) {
            await addCharactersToFavoriteFolder(folder.id, missing);
            missing.forEach(id => detail.ids.add(String(id)));
            added += missing.length;
          }
          detail.authors.add(author);
        } catch (e) {
          failed.push(`${author}：${e?.message || e}`);
        }
        updateStatus(`作者收藏夹整理进度：${created + reused}/${groups.size}，已加入 ${added} 个角色`);
        await sleep(180);
      }
      showToast(`作者收藏夹整理完成：新建 ${created} 个、复用 ${reused} 个、加入 ${added} 个角色${skippedMixed ? `；检测到 ${skippedMixed} 个同名混合夹，已跳过` : ''}${failed.length ? `；失败 ${failed.length} 项` : ''}`, failed.length ? 'err' : 'ok');
      updateStatus(failed.length ? `整理完成但有失败：${failed.slice(0, 2).join('；')}` : `作者收藏夹整理完成：新建 ${created}，复用 ${reused}，加入 ${added} 个角色。`, failed.length ? 'err' : 'ok');
    } catch (e) {
      showToast(`作者收藏夹整理失败：${e?.message || e}`, 'err');
      updateStatus(`作者收藏夹整理失败：${e?.message || e}`, 'err');
    } finally {
      if (button) { button.disabled = false; button.textContent = '按作者整理收藏夹'; }
    }
  }

  function renderRoleList() {
    renderFilteredRoles();
  }

  async function boot() {
    if (!document.body) return setTimeout(boot, 300);
    await loadScanCache();
    await loadArchiveCache();
    for (const role of scannedRoles) { const cached = archiveCache.get(String(role.id)); if (Array.isArray(cached) && cached.length) { role.hasChatHistory = true; role.archiveCount = cached.length; } }
    if (scannedRoles.length) await saveScanCache();
    await loadMaskCaches();
    initUI();
    if (scannedRoles.length) {
      renderFilteredRoles();
      updateReport();
      populateAuthorSelect();
      updateStatus(`已恢复上次扫描结果（${scannedRoles.length} 个角色）`);
      setPhase('上次扫描结果 · 已恢复', 100);

    }
    const resume = await loadResumeState();
    if (resume) {
      // 页面刷新或跳转时绝不自动续扫，也不弹窗。用户需要时可手动点击「继续扫描」。
      updateStatus('检测到上次未完成的扫描进度；如需继续，请手动点击「继续扫描」。');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();