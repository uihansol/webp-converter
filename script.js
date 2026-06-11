/* ============================================================
   WEBP · HEIC 일괄 변환기 — script.js
   - WEBP와 HEIC(아이폰 사진) 형식을 자동 판별해 JPG/PNG로 변환
   - 모든 변환은 브라우저(사용자 PC) 안에서만 처리됩니다.
   - 원본 파일은 읽기만 하며 절대 수정하지 않습니다.
   ============================================================ */

"use strict";

/* ------------------------------------------------------------
   0. 상태(State)
   ------------------------------------------------------------ */
const state = {
  files: [],          // 선택된 WEBP/HEIC File 객체 목록
  converting: false,  // 변환 진행 중 여부
  zipBlob: null,      // 생성된 ZIP Blob
  zipName: "",        // ZIP 파일명
};

/* ------------------------------------------------------------
   1. DOM 요소 참조
   ------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const dropZone        = $("dropZone");
const fileInput       = $("fileInput");
const folderInput     = $("folderInput");
const btnPickFiles    = $("btnPickFiles");
const btnPickFolder   = $("btnPickFolder");
const fileListSection = $("fileListSection");
const fileListEl      = $("fileList");
const fileCountEl     = $("fileCount");
const totalSizeEl     = $("totalSize");
const sizeLimitSelect = $("sizeLimit");
const customSizeRow   = $("customSizeRow");
const customSizeValue = $("customSizeValue");
const customSizeUnit  = $("customSizeUnit");
const pngLimitNote    = $("pngLimitNote");
const btnConvert      = $("btnConvert");
const btnReset        = $("btnReset");
const progressSection = $("progressSection");
const progressLabel   = $("progressLabel");
const progressCount   = $("progressCount");
const progressBar     = $("progressBar");
const progressTrack   = $("progressTrack");
const resultSection   = $("resultSection");
const resultSummary   = $("resultSummary");
const errorListEl     = $("errorList");
const warnListEl      = $("warnList");
const btnDownload     = $("btnDownload");

/* ------------------------------------------------------------
   2. 유틸리티 함수
   ------------------------------------------------------------ */

/** 바이트 수를 사람이 읽기 쉬운 문자열로 변환 (예: 1.2 MB) */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

/** 오늘 날짜를 YYYY-MM-DD 형식으로 반환 */
function todayString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 확장자를 제외한 파일명 반환 (IMG_001.webp → IMG_001) */
function baseName(name) {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

/**
 * 파일 형식 자동 판별 (확장자 + MIME 타입 기준)
 * @returns {"webp" | "heic" | null}  지원하지 않는 형식이면 null
 */
function detectFormat(file) {
  const name = file.name.toLowerCase();
  if (file.type === "image/webp" || name.endsWith(".webp")) return "webp";
  if (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  ) {
    return "heic";
  }
  return null;
}

/**
 * 파일 앞부분(매직 바이트)을 읽어 실제 형식인지 검증
 * - WEBP : "RIFF....WEBP" 헤더
 * - HEIC : 4번째 바이트부터 "ftyp" + heic 계열 브랜드(heic, heix, mif1 등)
 * 손상되었거나 확장자만 바꾼 위장 파일을 사전에 차단
 */
async function verifySignature(file, format) {
  try {
    const buf = await file.slice(0, 24).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const ascii = (start, len) =>
      String.fromCharCode(...bytes.slice(start, start + len));

    if (format === "webp") {
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    }

    if (format === "heic") {
      if (ascii(4, 4) !== "ftyp") return false;
      const brand = ascii(8, 4).toLowerCase();
      // 아이폰 사진에서 쓰이는 HEIC/HEIF 브랜드들
      return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]
        .includes(brand);
    }

    return false;
  } catch {
    return false; // 읽기 자체에 실패하면 손상으로 간주
  }
}

/* ------------------------------------------------------------
   3. 파일 선택 / 드래그 앤 드롭 처리
   ------------------------------------------------------------ */

/** 새 파일들을 목록에 추가 (WEBP/HEIC가 아닌 파일은 경고 후 제외, 중복 제거) */
function addFiles(fileLikeList) {
  const incoming = Array.from(fileLikeList);
  const rejected = [];

  for (const file of incoming) {
    // 형식 자동 판별 — 지원하지 않는 형식은 제외
    if (detectFormat(file) === null) {
      rejected.push(file.name);
      continue;
    }
    // 동일한 이름+크기 파일은 중복으로 보고 건너뜀
    const dup = state.files.some(
      (f) => f.name === file.name && f.size === file.size
    );
    if (!dup) state.files.push(file);
  }

  renderFileList();

  if (rejected.length > 0) {
    alert(
      `WEBP/HEIC가 아닌 파일 ${rejected.length}개는 제외했어요:\n` +
      rejected.slice(0, 10).join("\n") +
      (rejected.length > 10 ? `\n…외 ${rejected.length - 10}개` : "")
    );
  }
}

/** 파일 목록 화면 갱신 */
function renderFileList() {
  fileListEl.innerHTML = "";

  if (state.files.length === 0) {
    fileListSection.hidden = true;
    btnConvert.disabled = true;
    return;
  }

  let totalBytes = 0;

  state.files.forEach((file, idx) => {
    totalBytes += file.size;

    const li = document.createElement("li");

    // 형식 배지 (WEBP / HEIC)
    const fmt = detectFormat(file);
    const badge = document.createElement("span");
    badge.className = "file-badge" + (fmt === "heic" ? " heic" : "");
    badge.textContent = fmt ? fmt.toUpperCase() : "?";

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = file.name;
    nameSpan.title = file.name;

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "file-size";
    sizeSpan.textContent = formatBytes(file.size);

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `${file.name} 목록에서 제거`);
    removeBtn.addEventListener("click", () => {
      state.files.splice(idx, 1);
      renderFileList();
    });

    li.append(badge, nameSpan, sizeSpan, removeBtn);
    fileListEl.appendChild(li);
  });

  fileCountEl.textContent = `총 ${state.files.length}개 파일`;
  totalSizeEl.textContent = `합계 ${formatBytes(totalBytes)}`;
  fileListSection.hidden = false;
  btnConvert.disabled = state.converting;
}

/* --- 버튼으로 파일/폴더 선택 --- */
btnPickFiles.addEventListener("click", () => fileInput.click());
btnPickFolder.addEventListener("click", () => folderInput.click());

fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
  fileInput.value = ""; // 같은 파일 재선택 가능하도록 초기화
});

folderInput.addEventListener("change", (e) => {
  // 폴더 선택 시 모든 파일이 들어오므로 addFiles에서 WEBP/HEIC만 걸러냄
  addFiles(e.target.files);
  folderInput.value = "";
});

/* --- 드롭존 클릭/키보드 --- */
dropZone.addEventListener("click", (e) => {
  // 내부 버튼 클릭은 버튼 자체 동작에 맡김
  if (e.target.closest("button")) return;
  fileInput.click();
});
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

/* --- 드래그 앤 드롭 --- */
["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
  })
);

dropZone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) {
    addFiles(e.dataTransfer.files);
  }
});

/* 페이지 전체에서 실수로 드롭했을 때 브라우저가 파일을 열지 않도록 차단 */
["dragover", "drop"].forEach((evt) =>
  window.addEventListener(evt, (e) => e.preventDefault())
);

/* ------------------------------------------------------------
   4. 변환 옵션 처리
   ------------------------------------------------------------ */

/** 현재 선택된 출력 형식 반환 ("jpg" | "png") */
function getSelectedFormat() {
  return document.querySelector('input[name="format"]:checked').value;
}

/** 현재 설정된 최대 용량(바이트) 반환. 0이면 제한 없음 */
function getSizeLimitBytes() {
  const v = sizeLimitSelect.value;
  if (v === "custom") {
    const num = parseFloat(customSizeValue.value);
    const unit = parseInt(customSizeUnit.value, 10);
    if (!num || num <= 0) return 0; // 잘못된 입력은 제한 없음으로 처리
    return Math.floor(num * unit);
  }
  return parseInt(v, 10);
}

/* 직접 입력 선택 시 입력란 표시 */
sizeLimitSelect.addEventListener("change", () => {
  customSizeRow.hidden = sizeLimitSelect.value !== "custom";
  updatePngNote();
});

/* PNG + 용량 제한 조합일 때 안내 문구 표시 */
function updatePngNote() {
  const isPng = getSelectedFormat() === "png";
  const hasLimit =
    sizeLimitSelect.value !== "0";
  pngLimitNote.hidden = !(isPng && hasLimit);
}

document
  .querySelectorAll('input[name="format"]')
  .forEach((radio) => radio.addEventListener("change", updatePngNote));

/* ------------------------------------------------------------
   5. 이미지 변환 핵심 로직
   ------------------------------------------------------------ */

/**
 * 이미지 파일을 디코딩해 캔버스에 그림 (형식 자동 분기)
 * - WEBP : 브라우저 내장 디코더(createImageBitmap) 사용
 * - HEIC : 브라우저가 직접 못 읽으므로 heic2any로 먼저 PNG Blob으로 변환
 * @param {File} file
 * @param {"webp"|"heic"} format
 * @returns {HTMLCanvasElement}
 * @throws 디코딩 실패(손상 파일 등) 시 예외 발생
 */
async function decodeToCanvas(file, format) {
  let source = file;

  if (format === "heic") {
    // heic2any는 결과를 Blob 또는 Blob 배열(다중 이미지 HEIC)로 반환
    const converted = await heic2any({ blob: file, toType: "image/png" });
    source = Array.isArray(converted) ? converted[0] : converted;
  }

  const bitmap = await createImageBitmap(source);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // 메모리 해제

  return canvas;
}

/** 캔버스를 지정 형식/품질의 Blob으로 변환 (Promise 래퍼) */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("인코딩 실패"))),
      mimeType,
      quality
    );
  });
}

/**
 * JPG 변환: 이진 탐색으로 품질을 조정해 목표 용량에 최대한 근접
 * @param {HTMLCanvasElement} canvas
 * @param {number} limitBytes  0이면 제한 없음
 * @returns {{blob: Blob, overLimit: boolean}}
 */
async function encodeJpgWithLimit(canvas, limitBytes) {
  // JPG는 투명도를 지원하지 않으므로 흰색 배경을 깔아줌
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);

  // 제한 없음 → 고품질(0.92)로 한 번에 인코딩
  if (!limitBytes) {
    return { blob: await canvasToBlob(flat, "image/jpeg", 0.92), overLimit: false };
  }

  // 먼저 고품질로 시도 → 이미 제한 이하면 그대로 사용
  let best = await canvasToBlob(flat, "image/jpeg", 0.92);
  if (best.size <= limitBytes) return { blob: best, overLimit: false };

  // 품질 이진 탐색 (0.05 ~ 0.92, 7회면 충분히 수렴)
  let lo = 0.05, hi = 0.92;
  let fit = null; // 제한 이하 중 가장 좋은 품질의 결과

  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToBlob(flat, "image/jpeg", mid);
    if (blob.size <= limitBytes) {
      fit = blob;     // 제한 안에 들어옴 → 품질을 더 올려봄
      lo = mid;
    } else {
      hi = mid;       // 제한 초과 → 품질을 낮춤
    }
  }

  if (fit) return { blob: fit, overLimit: false };

  // 최저 품질로도 제한을 못 맞추는 경우 → 최저 품질 결과 반환 + 표시
  const lowest = await canvasToBlob(flat, "image/jpeg", 0.05);
  return { blob: lowest, overLimit: lowest.size > limitBytes };
}

/**
 * PNG 변환: 무손실이라 품질 조절 불가.
 * 제한 초과 시 그대로 저장하되 overLimit 플래그로 안내
 */
async function encodePng(canvas, limitBytes) {
  const blob = await canvasToBlob(canvas, "image/png");
  const overLimit = limitBytes > 0 && blob.size > limitBytes;
  return { blob, overLimit };
}

/* ------------------------------------------------------------
   6. 일괄 변환 실행
   ------------------------------------------------------------ */

/** 진행 상황 UI 갱신 */
function updateProgress(current, total, fileName) {
  const percent = total === 0 ? 0 : Math.round((current / total) * 100);
  progressBar.style.width = percent + "%";
  progressTrack.setAttribute("aria-valuenow", String(percent));
  progressCount.textContent = `${current} / ${total}`;
  progressLabel.textContent = fileName
    ? `처리 중: ${fileName}`
    : "완료되었습니다";
}

/** 변환 중 버튼 잠금/해제 */
function setConverting(on) {
  state.converting = on;
  btnConvert.disabled = on || state.files.length === 0;
  btnReset.disabled = on;
  btnPickFiles.disabled = on;
  btnPickFolder.disabled = on;
  btnConvert.textContent = on ? "변환 중…" : "변환 시작";
}

btnConvert.addEventListener("click", async () => {
  if (state.files.length === 0 || state.converting) return;

  const format = getSelectedFormat();          // "jpg" | "png"
  const limitBytes = getSizeLimitBytes();      // 0 = 제한 없음
  const formatUpper = format.toUpperCase();    // "JPG" | "PNG"
  const folderName = `Converted_${formatUpper}`;

  // UI 초기화
  setConverting(true);
  resultSection.hidden = true;
  errorListEl.hidden = true;
  warnListEl.hidden = true;
  btnDownload.hidden = true;
  errorListEl.innerHTML = "";
  warnListEl.innerHTML = "";
  progressSection.hidden = false;
  updateProgress(0, state.files.length, state.files[0]?.name || "");

  const zip = new JSZip();
  const folder = zip.folder(folderName); // ZIP 내부 폴더에 변환본 저장

  const errors = [];      // 변환 실패 파일 목록
  const overLimits = [];  // 용량 제한 초과 파일 목록
  const usedNames = new Set(); // ZIP 내 파일명 중복 방지
  let successCount = 0;

  for (let i = 0; i < state.files.length; i++) {
    const file = state.files[i];
    updateProgress(i, state.files.length, file.name);

    try {
      // (1) 형식 자동 판별 (webp | heic)
      const srcFormat = detectFormat(file);
      if (!srcFormat) throw new Error("지원하지 않는 형식");

      // (2) 매직 바이트 검증 — 손상/위장 파일 사전 차단
      const valid = await verifySignature(file, srcFormat);
      if (!valid) {
        throw new Error(
          `${srcFormat.toUpperCase()} 형식이 아니거나 손상된 파일`
        );
      }

      // (3) 디코딩 (HEIC는 heic2any로 먼저 변환)
      const canvas = await decodeToCanvas(file, srcFormat);

      // (4) 인코딩 (출력 형식별)
      const result =
        format === "jpg"
          ? await encodeJpgWithLimit(canvas, limitBytes)
          : await encodePng(canvas, limitBytes);

      if (result.overLimit) {
        overLimits.push(
          `${file.name} → ${formatBytes(result.blob.size)} (제한 초과)`
        );
      }

      // (5) ZIP에 추가 — 동일 파일명 충돌 시 (2), (3)… 붙임
      let outName = `${baseName(file.name)}.${format}`;
      let n = 2;
      while (usedNames.has(outName)) {
        outName = `${baseName(file.name)} (${n}).${format}`;
        n++;
      }
      usedNames.add(outName);
      folder.file(outName, result.blob);

      successCount++;
    } catch (err) {
      // 실패해도 전체 작업은 계속 진행
      errors.push(`${file.name} — ${err.message || "변환 실패"}`);
    }

    updateProgress(i + 1, state.files.length, "");
    // UI가 멈춘 것처럼 보이지 않도록 이벤트 루프에 양보
    await new Promise((r) => setTimeout(r, 0));
  }

  updateProgress(state.files.length, state.files.length, "");

  /* ----- ZIP 생성 ----- */
  state.zipBlob = null;
  state.zipName = `Converted_${formatUpper}_${todayString()}.zip`;

  if (successCount > 0) {
    try {
      progressLabel.textContent = "ZIP 파일 생성 중…";
      state.zipBlob = await zip.generateAsync({ type: "blob" });
      progressLabel.textContent = "완료되었습니다";
    } catch (err) {
      errors.push(`ZIP 생성 실패 — ${err.message}`);
    }
  }

  /* ----- 결과 표시 ----- */
  resultSummary.textContent =
    `변환 완료: ${successCount}개 성공` +
    (errors.length ? ` · ${errors.length}개 실패` : "") +
    (state.zipBlob ? ` · ZIP 크기 ${formatBytes(state.zipBlob.size)}` : "");

  if (errors.length > 0) {
    errors.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = "⚠ " + msg;
      errorListEl.appendChild(li);
    });
    errorListEl.hidden = false;
  }

  if (overLimits.length > 0) {
    const head = document.createElement("li");
    head.textContent =
      format === "png"
        ? "PNG는 무손실 형식이라 아래 파일은 설정한 용량 이하로 줄이지 못했어요:"
        : "최저 품질로도 아래 파일은 설정한 용량 이하로 줄이지 못했어요:";
    warnListEl.appendChild(head);
    overLimits.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = "· " + msg;
      warnListEl.appendChild(li);
    });
    warnListEl.hidden = false;
  }

  btnDownload.hidden = !state.zipBlob;
  resultSection.hidden = false;
  setConverting(false);
});

/* ------------------------------------------------------------
   7. 다운로드 / 초기화
   ------------------------------------------------------------ */

btnDownload.addEventListener("click", () => {
  if (!state.zipBlob) return;
  // FileSaver.js의 saveAs로 ZIP 저장 (다운로드 폴더에 저장됨)
  saveAs(state.zipBlob, state.zipName);
});

btnReset.addEventListener("click", () => {
  if (state.converting) return;
  state.files = [];
  state.zipBlob = null;
  state.zipName = "";
  renderFileList();
  progressSection.hidden = true;
  resultSection.hidden = true;
  errorListEl.innerHTML = "";
  warnListEl.innerHTML = "";
  updateProgress(0, 0, "");
});

/* ------------------------------------------------------------
   8. 초기 상태
   ------------------------------------------------------------ */
updatePngNote();
renderFileList();
