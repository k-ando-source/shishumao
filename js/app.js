/*!
 * ししゅまお - app.js
 * 画面まわり（読み込み・プレビュー・保存）
 */
(function () {
  'use strict';

  var MAX_SIDE = 1600;              // 作業解像度（長辺）
  var $ = function (id) { return document.getElementById(id); };

  var picker = $('picker'), editor = $('editor'), stage = document.querySelector('.stage');
  var resultImg = $('result'), originalImg = $('original'), sizeLabel = $('sizeLabel');
  var toastEl = $('toast');

  var srcCanvas = document.createElement('canvas');   // 元画像（作業解像度）
  var outCanvas = document.createElement('canvas');   // 生成結果
  var srcData = null;                                 // ImageData
  var resultUrl = null, originalUrl = null, resultBlob = null;
  var renderTimer = null, rendering = false, pending = false;

  var DEFAULTS = { mode: 'sketch', density: 50, detail: 50, thickness: 1, denoise: 30, invert: false };

  var HINTS = {
    sketch: 'イラストや人物写真に。やわらかい手描き風の線になります。',
    outline: '形をはっきり出したいときに。輪郭だけを細い線で拾います。',
    flat: 'スクショ・ロゴ・文字入りの画像に。ベタ面と文字をきれいに拾います。'
  };

  /* ---------- 画像の読み込み ---------- */

  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('画像ファイルをえらんでください'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      srcCanvas.width = w; srcCanvas.height = h;
      var ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);      // 透過は白で合成
      ctx.drawImage(img, 0, 0, w, h);
      srcData = ctx.getImageData(0, 0, w, h);
      resultBlob = null;
      URL.revokeObjectURL(url);

      if (originalUrl) URL.revokeObjectURL(originalUrl);
      srcCanvas.toBlob(function (b) {
        originalUrl = URL.createObjectURL(b);
        originalImg.src = originalUrl;
      }, 'image/png');

      sizeLabel.textContent = w + ' × ' + h + ' px';
      picker.hidden = true;
      editor.hidden = false;
      window.scrollTo(0, 0);
      render();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('この画像は読み込めませんでした');
    };
    img.src = url;
  }

  /* ---------- 生成 ---------- */

  function options() {
    return {
      mode: document.querySelector('#modeSeg .is-on').dataset.mode,
      density: +$('density').value / 100,
      detail: +$('detail').value / 100,
      thickness: +$('thickness').value,
      denoise: +$('denoise').value / 100,
      contrast: 0,
      invert: $('invert').checked
    };
  }

  function render() {
    if (!srcData) return;
    if (rendering) { pending = true; return; }
    rendering = true;
    stage.classList.add('is-busy');

    // 「つくり中…」を先に描かせてから重い処理へ（rAF は非表示タブで止まるので使わない）
    setTimeout(function () {
      var done = function () {
        stage.classList.remove('is-busy');
        rendering = false;
        if (pending) { pending = false; render(); }
      };
      var out;
      try {
        out = LineArt.process(srcData, options());
      } catch (e) {
        done();
        toast('うまく処理できませんでした');
        return;
      }
      outCanvas.width = out.width; outCanvas.height = out.height;
      outCanvas.getContext('2d').putImageData(out, 0, 0);
      outCanvas.toBlob(function (blob) {
        if (blob) {
          resultBlob = blob;                       // 保存でそのまま使う（共有時の操作権限を保つため）
          if (resultUrl) URL.revokeObjectURL(resultUrl);
          resultUrl = URL.createObjectURL(blob);
          resultImg.src = resultUrl;
        }
        done();
      }, 'image/png');
    }, 30);
  }

  function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 160);
  }

  /* ---------- 保存 ---------- */

  function fileName() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return 'shishumao_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.png';
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('下絵を保存しました');
  }

  // 保存。iPhone では共有シート（→「画像を保存」で写真アプリへ）
  function save() {
    if (!resultBlob) { toast('まだ下絵ができていません'); return; }
    var name = fileName();
    var blob = resultBlob;
    var file;
    try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file] }).catch(function (err) {
        // キャンセル以外（共有が使えない等）はダウンロードにフォールバック
        if (err && err.name === 'AbortError') return;
        download(blob, name);
      });
      return;
    }
    download(blob, name);
  }

  /* ---------- ちいさな通知 ---------- */

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  /* ---------- イベント ---------- */

  ['fileInput', 'fileInput2', 'cameraInput'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
      e.target.value = '';
    });
  });

  // ドラッグ＆ドロップ（PC）
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); picker.classList.add('is-drag'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); picker.classList.remove('is-drag'); });
  });
  document.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  // ペースト（スクショの貼り付け）
  document.addEventListener('paste', function (e) {
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) { loadFile(items[i].getAsFile()); break; }
    }
  });

  // モード切り替え
  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('is-on'); });
    b.classList.add('is-on');
    $('modeHint').textContent = HINTS[b.dataset.mode];
    render();
  });

  // スライダー
  [['density', 'densityVal'], ['detail', 'detailVal'], ['thickness', 'thicknessVal'], ['denoise', 'denoiseVal']]
    .forEach(function (pair) {
      var input = $(pair[0]), label = $(pair[1]);
      input.addEventListener('input', function () { label.textContent = input.value; renderSoon(); });
    });

  $('invert').addEventListener('change', render);

  $('resetBtn').addEventListener('click', function () {
    Array.prototype.forEach.call($('modeSeg').children, function (c) {
      c.classList.toggle('is-on', c.dataset.mode === DEFAULTS.mode);
    });
    $('modeHint').textContent = HINTS[DEFAULTS.mode];
    ['density', 'detail', 'thickness', 'denoise'].forEach(function (k) {
      $(k).value = DEFAULTS[k];
      $(k + 'Val').textContent = DEFAULTS[k];
    });
    $('invert').checked = DEFAULTS.invert;
    render();
  });

  // 元画像くらべ（ボタンを押しているあいだだけ元画像）
  // ※ 画像そのものには付けない：iPhone の「長押し→"写真"に追加」を邪魔しないため
  var compareBtn = $('compareBtn');
  function showOriginal(on) {
    if (!originalUrl) return;
    originalImg.hidden = !on;
    resultImg.hidden = on;
    compareBtn.classList.toggle('is-on', on);
  }
  compareBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); showOriginal(true); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    compareBtn.addEventListener(t, function () { showOriginal(false); });
  });

  $('saveBtn').addEventListener('click', save);

  // オフラインでも使えるように
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
