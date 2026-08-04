state.assigned = [];
state.shelfIndex = 0;

const shelfPhase = document.createElement("section");
shelfPhase.className = "panel phase";
shelfPhase.id = "shelfPhase";
document.querySelector("main").appendChild(shelfPhase);

function startAnotherBatch() {
  state.barcodes = [];
  state.captures = [];
  state.reviewIndex = 0;
  state.candidates = [];
  state.selectedIndex = -1;
  state.assigned = [];
  state.shelfIndex = 0;
  manualSearch.value = "";
  cover.removeAttribute("src");
  matches.innerHTML = "";
  ocrText.textContent = "Start a new barcode batch.";
  renderStack();
  setPhase("scan");
  shelfPhase.classList.remove("active");
  barcode.focus();
}

function showShelfStep() {
  scanPhase.classList.remove("active");
  capturePhase.classList.remove("active");
  reviewPhase.classList.remove("active");
  shelfPhase.classList.add("active");
  renderShelfStep();
}

function renderShelfStep() {
  const item = state.assigned[state.shelfIndex];
  if (!item) {
    shelfPhase.innerHTML = `
      <h2>4 · Shelf placement complete</h2>
      <div class="note">Every assigned album in this batch has been shown.</div>
      <div class="actions"><button id="restartBatch" type="button">Start another search</button></div>
    `;
    document.getElementById("restartBatch").onclick = startAnotherBatch;
    return;
  }

  shelfPhase.innerHTML = `
    <h2>4 · Place album</h2>
    <div class="note">${state.shelfIndex + 1} of ${state.assigned.length} · Press Space for next album</div>
    <div style="margin-top:24px;font-size:clamp(28px,5vw,54px);font-weight:bold">${esc(item.artist)}</div>
    <div style="margin-top:8px;font-size:clamp(20px,3vw,34px);color:var(--muted)">${esc(item.title)}</div>
    <div style="margin:30px 0;font-size:clamp(60px,12vw,130px);font-weight:bold;color:var(--accent)">${esc(item.new_shelf || "--")}</div>
    <div class="actions"><button id="nextShelf" type="button">Next album (Space)</button></div>
  `;
  document.getElementById("nextShelf").onclick = () => {
    state.shelfIndex += 1;
    renderShelfStep();
  };
}

async function batchAssignCurrent() {
  const item = state.captures[state.reviewIndex];
  const album = state.candidates[state.selectedIndex];
  if (!item || !album) return;

  assign.disabled = true;
  try {
    const response = await api("/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode: item.barcode, albumId: album.id }),
    });
    state.assigned.push({ ...response.album, barcode: item.barcode });
    item.image = null;
    state.captures.splice(state.reviewIndex, 1);
    manualSearch.value = "";
    reviewIndexAfterRemove(`Assigned ${item.barcode}.`);
  } catch (error) {
    reviewStatus.textContent = error.message;
    reviewStatus.className = "status error";
    assign.disabled = false;
  }
}

function reviewIndexAfterRemove(message) {
  if (!state.captures.length) {
    showShelfStep();
    return;
  }

  state.reviewIndex = Math.min(state.reviewIndex, state.captures.length - 1);
  loadReview();
  reviewStatus.textContent = message;
  reviewStatus.className = "status good";
}

assign.onclick = batchAssignCurrent;
manualSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && state.selectedIndex >= 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
    batchAssignCurrent();
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (shelfPhase.classList.contains("active") && event.code === "Space") {
    event.preventDefault();
    document.getElementById("nextShelf")?.click();
    return;
  }
  if (reviewPhase.classList.contains("active") && event.key === "Enter" && event.target !== manualSearch) {
    event.preventDefault();
    event.stopImmediatePropagation();
    batchAssignCurrent();
  }
}, true);
