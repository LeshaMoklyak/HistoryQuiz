document.addEventListener("DOMContentLoaded", () => {

// --- Запрет копирования ---
document.addEventListener("copy", e => e.preventDefault());
document.addEventListener("cut",  e => e.preventDefault());

// ============================================================
// Конфигурация тренажёров
// ============================================================
const QUIZ_CONFIGS = {
    personalities: {
        dataFile:    "data/pairs.json",
        storageKey:  "historyQuizPairsV2",
        title:       "Личности",
        instruction: "По одному событию из каждой большой темы курса",
    },
    facts: {
        dataFile:    "data/facts.json",
        storageKey:  "historyQuizFactsV1",
        title:       "Факты",
        instruction: "По одному событию из каждой большой темы курса",
    },
    culture: {
        dataFile:    "data/culture.json",
        storageKey:  "historyQuizCultureV1",
        title:       "Культура",
        instruction: "По одному произведению из каждой большой темы курса",
    }
};

// ============================================================
// DOM-элементы
// ============================================================
const startModal   = document.getElementById("start-modal");
const finishModal  = document.getElementById("finish-modal");
const finalText    = document.getElementById("final-text");
const quizTitle    = document.getElementById("quiz-title");

const matchingGrid = document.getElementById("matching-grid");
const optionsGrid  = document.getElementById("options-grid");
const checkBtn     = document.getElementById("check-btn");
const resetBtn     = document.getElementById("reset-btn");
const feedback     = document.getElementById("feedback");

const questionNumber      = document.getElementById("question-number");
const questionDescription = document.getElementById("question-description");
const progressFill        = document.getElementById("progress-fill");
const progressText        = document.getElementById("progress-text");
const scoreValue          = document.getElementById("score-value");

// ============================================================
// Состояние
// ============================================================
const pairsCache  = {};
let currentConfig   = null;
let allPairs        = [];
let pairQueue       = [];
let solvedCount     = 0;
let totalPairs      = 0;
let score           = 0;
let currentQuestion = null;
let isChecking      = false;
let userAnswers     = {};
let selectedOption  = null;   // для клика мышью

let touchDragData = null;
let dragClone     = null;

document.addEventListener("touchmove", e => {
    if (!dragClone) return;
    e.preventDefault();
    const t = e.touches[0];
    dragClone.style.left = (t.clientX - dragClone.offsetWidth  / 2) + "px";
    dragClone.style.top  = (t.clientY - dragClone.offsetHeight / 2) + "px";
}, { passive: false });

document.addEventListener("touchend", e => {
    if (!dragClone || !touchDragData) return;
    const t = e.changedTouches[0];
    dragClone.remove(); dragClone = null;
    const el   = document.elementFromPoint(t.clientX, t.clientY);
    const slot = el && el.closest(".answer-slot");
    if (slot && currentQuestion) performDrop(slot, touchDragData.id, touchDragData.text, currentQuestion);
    touchDragData = null;
});

// ============================================================
// Выбор тренажёра
// ============================================================
document.querySelectorAll(".quiz-card").forEach(card => {
    card.addEventListener("click", async () => {
        currentConfig = QUIZ_CONFIGS[card.dataset.quiz];
        startModal.classList.remove("show");
        startModal.classList.add("hidden");
        quizTitle.textContent = `История · ${currentConfig.title}`;
        await initQuiz();
    });
});

// ============================================================
// Инициализация квиза
// ============================================================
async function initQuiz() {
    const quizType = Object.keys(QUIZ_CONFIGS).find(k => QUIZ_CONFIGS[k] === currentConfig);

    if (!pairsCache[quizType]) {
        try {
            const res  = await fetch(currentConfig.dataFile);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            pairsCache[quizType] = data.pairs;
        } catch (err) {
            console.error("Ошибка загрузки:", err);
            alert("Не удалось загрузить данные. Попробуйте обновить страницу.");
            return;
        }
    }

    allPairs   = pairsCache[quizType];
    totalPairs = allPairs.length;

    const saved = JSON.parse(localStorage.getItem(currentConfig.storageKey));
    if (saved?.remainingIds && saved.solvedCount !== undefined) {
        solvedCount = saved.solvedCount;
        score       = saved.score ?? 0;
        const rem   = new Set(saved.remainingIds);
        pairQueue   = allPairs.filter(p => rem.has(p.id));
    } else {
        solvedCount = 0;
        score       = 0;
        pairQueue   = shuffle([...allPairs]);
    }

    updateProgress();
    updateScoreDisplay();
    loadQuestion();
}

// ============================================================
// Утилиты
// ============================================================
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function saveProgress() {
    localStorage.setItem(currentConfig.storageKey, JSON.stringify({
        solvedCount, score,
        remainingIds: pairQueue.map(p => p.id)
    }));
}

// "Подтема 1.2." → "1"
function getThemeNum(subtopic) {
    const m = subtopic.match(/(\d+)\.\d+/);
    return m ? m[1] : subtopic;
}

function formatScore(s) {
    return String(s);
}

// ============================================================
// Дистракторы: из любых других подтем (разных между собой)
// ============================================================
function getDistractors(selectedPairs, count = 2) {
    const usedSubs    = new Set(selectedPairs.map(p => p.subtopic));
    const usedPersons = new Set(selectedPairs.map(p => p.person));
    const seen = new Set();
    const pool = [];
    for (const p of allPairs) {
        if (!usedSubs.has(p.subtopic) && !usedPersons.has(p.person) && !seen.has(p.person)) {
            seen.add(p.person);
            pool.push(p.person);
        }
    }
    shuffle(pool);
    return pool.slice(0, count);
}

// ============================================================
// Построение вопроса: по 1 паре из каждой из 4 тем
// ============================================================
function buildQuestion() {
    if (pairQueue.length === 0) return null;

    const selected    = [];
    const usedPersons = new Set();
    const usedEvents  = new Set();

    for (const theme of ["1", "2", "3", "4"]) {
        const idx = pairQueue.findIndex(p =>
            getThemeNum(p.subtopic) === theme &&
            !usedPersons.has(p.person) &&
            !usedEvents.has(p.event)
        );
        if (idx !== -1) {
            selected.push(pairQueue[idx]);
            usedPersons.add(pairQueue[idx].person);
            usedEvents.add(pairQueue[idx].event);
        }
    }

    if (selected.length < 4) {
        for (let i = 0; i < pairQueue.length && selected.length < 4; i++) {
            const p = pairQueue[i];
            if (!selected.some(s => s.id === p.id) &&
                !usedPersons.has(p.person) &&
                !usedEvents.has(p.event)) {
                selected.push(p);
                usedPersons.add(p.person);
                usedEvents.add(p.event);
            }
        }
    }

    if (selected.length === 0) return null;

    const selIds = new Set(selected.map(p => p.id));
    pairQueue = pairQueue.filter(p => !selIds.has(p.id));

    shuffle(selected);

    const distractors  = getDistractors(selected);
    const participants = shuffle([
        ...selected.map(p    => ({ id: `p${p.id}`, text: p.person })),
        ...distractors.map((name, i) => ({ id: `d${i}_${Date.now()}`, text: name }))
    ]);

    return { pairs: selected, events: selected.map(p => ({ text: p.event })), participants };
}

// ============================================================
// Загрузка и рендер вопроса
// ============================================================
function loadQuestion() {
    const q = buildQuestion();

    if (!q) {
        finalText.textContent =
            `Все соответствия выучены! Итоговый счёт: ${formatScore(score)} баллов`;
        finishModal.classList.remove("hidden");
        // Двойной rAF гарантирует, что display:none → block отрисуется раньше перехода
        requestAnimationFrame(() => requestAnimationFrame(() => {
            finishModal.classList.add("show");
        }));
        updateProgress();
        return;
    }

    currentQuestion = q;
    userAnswers     = {};
    isChecking      = false;
    selectedOption  = null;

    feedback.textContent = "";
    feedback.className   = "feedback";
    checkBtn.disabled    = true;

    questionNumber.textContent      = "Установите соответствие";
    questionDescription.textContent = currentConfig.instruction;

    matchingGrid.innerHTML  = "";
    optionsGrid.innerHTML   = "";

    // Рендерим пары event+slot вперемешку — CSS grid (1fr 1fr) выровняет их по строкам
    const pairsFrag = document.createDocumentFragment();
    q.events.forEach((ev, i) => {
        const item = document.createElement("div");
        item.className        = "event-item";
        item.textContent      = `${i + 1}. ${ev.text}`;
        item.style.animationDelay = `${0.03 + i * 0.03}s`;
        pairsFrag.appendChild(item);

        const slot = document.createElement("div");
        slot.className        = "answer-slot";
        slot.dataset.index    = String(i);
        slot.textContent      = "Нажмите или перетащите";
        slot.style.animationDelay = `${0.04 + i * 0.03}s`;
        slot.setAttribute("role", "region");
        slot.setAttribute("aria-label", `Слот для ответа ${i + 1}`);
        pairsFrag.appendChild(slot);
    });
    matchingGrid.appendChild(pairsFrag);

    const optFrag = document.createDocumentFragment();
    q.participants.forEach(p => {
        const opt = document.createElement("div");
        opt.className   = "option";
        opt.draggable   = true;
        opt.dataset.id  = p.id;
        opt.textContent = p.text;
        opt.setAttribute("role", "button");
        opt.setAttribute("aria-label", p.text);
        optFrag.appendChild(opt);
    });
    optionsGrid.appendChild(optFrag);

    setupDnD(q);
    updateProgress();
}

// ============================================================
// Общая логика drop
// ============================================================
function performDrop(slot, id, text, q) {
    const index = slot.dataset.index;
    if (userAnswers[index]) {
        const old = document.querySelector(`[data-id="${userAnswers[index]}"]`);
        if (old) old.classList.remove("used");
    }
    const prev = Object.keys(userAnswers).find(k => userAnswers[k] === id);
    if (prev !== undefined) {
        const ps = document.querySelector(`.answer-slot[data-index="${prev}"]`);
        if (ps) { ps.textContent = "Нажмите или перетащите"; ps.classList.remove("filled"); }
        delete userAnswers[prev];
    }
    userAnswers[index] = id;
    slot.textContent   = text;
    slot.classList.add("filled");
    const optEl = document.querySelector(`[data-id="${id}"]`);
    if (optEl) optEl.classList.add("used");
    checkBtn.disabled = Object.keys(userAnswers).length < q.events.length;
}

// ============================================================
// Drag & Drop — мышь, touch и клик
// ============================================================
function setupDnD(q) {
    document.querySelectorAll(".option").forEach(opt => {
        // Drag (мышь)
        opt.addEventListener("dragstart", e => {
            e.dataTransfer.setData("id",   opt.dataset.id);
            e.dataTransfer.setData("text", opt.textContent);
        });

        // Touch (мобильный)
        opt.addEventListener("touchstart", e => {
            if (opt.classList.contains("used")) return;
            e.preventDefault();
            const touch = e.touches[0];
            touchDragData = { id: opt.dataset.id, text: opt.textContent };
            dragClone = opt.cloneNode(true);
            dragClone.style.cssText = `
                position:fixed;opacity:0.9;z-index:9999;pointer-events:none;
                width:${opt.offsetWidth}px;
                left:${touch.clientX - opt.offsetWidth  / 2}px;
                top:${touch.clientY  - opt.offsetHeight / 2}px;
                margin:0;border-radius:8px;will-change:left,top;
            `;
            document.body.appendChild(dragClone);
        }, { passive: false });

        // Клик (выбор мышью)
        opt.addEventListener("click", () => {
            if (isChecking || opt.classList.contains("used")) return;
            if (selectedOption?.element === opt) {
                opt.classList.remove("selected");
                selectedOption = null;
            } else {
                if (selectedOption) selectedOption.element.classList.remove("selected");
                opt.classList.add("selected");
                selectedOption = { id: opt.dataset.id, text: opt.textContent, element: opt };
            }
        });
    });

    document.querySelectorAll(".answer-slot").forEach(slot => {
        slot.addEventListener("dragover", e => e.preventDefault());
        slot.addEventListener("drop", e => {
            e.preventDefault();
            performDrop(slot, e.dataTransfer.getData("id"), e.dataTransfer.getData("text"), q);
        });

        // Touch: убрать ответ из слота при тапе на заполненный слот
        slot.addEventListener("touchstart", e => {
            if (dragClone) return;
            if (!slot.classList.contains("filled")) return;
            e.preventDefault();
            const id = userAnswers[slot.dataset.index];
            if (!id) return;
            delete userAnswers[slot.dataset.index];
            slot.textContent = "Нажмите или перетащите";
            slot.classList.remove("filled");
            const optEl = document.querySelector(`[data-id="${id}"]`);
            if (optEl) optEl.classList.remove("used");
            checkBtn.disabled = Object.keys(userAnswers).length < q.events.length;
        }, { passive: false });

        // Клик: поместить выбранный вариант или очистить слот
        slot.addEventListener("click", () => {
            if (isChecking) return;
            if (selectedOption) {
                performDrop(slot, selectedOption.id, selectedOption.text, q);
                selectedOption.element.classList.remove("selected");
                selectedOption = null;
            } else if (slot.classList.contains("filled")) {
                const id = userAnswers[slot.dataset.index];
                if (!id) return;
                delete userAnswers[slot.dataset.index];
                slot.textContent = "Нажмите или перетащите";
                slot.classList.remove("filled");
                const optEl = document.querySelector(`[data-id="${id}"]`);
                if (optEl) optEl.classList.remove("used");
                checkBtn.disabled = Object.keys(userAnswers).length < q.events.length;
            }
        });
    });
}

// ============================================================
// Проверка ответа
// ============================================================
checkBtn.onclick = () => {
    if (isChecking) return;
    isChecking        = true;
    checkBtn.disabled = true;

    // Снимаем выделение с выбранного варианта
    if (selectedOption) {
        selectedOption.element.classList.remove("selected");
        selectedOption = null;
    }

    const q          = currentQuestion;
    const wrongPairs = [];

    q.pairs.forEach((pair, i) => {
        const slot = document.querySelector(`.answer-slot[data-index="${i}"]`);
        if (!slot) return;
        if (userAnswers[String(i)] === `p${pair.id}`) {
            solvedCount++;
            slot.classList.add("correct");
        } else {
            wrongPairs.push(pair);
            slot.classList.add("incorrect");
        }
    });

    const allCorrect = wrongPairs.length === 0;
    if (allCorrect) {
        score += 2;
        feedback.textContent = "✓ Верно! +2 балла";
        feedback.className   = "feedback success";
        showDelta("+2");
    } else {
        const right = q.pairs.length - wrongPairs.length;
        feedback.textContent = right > 0
            ? `✓ ${right} верно   |   ✗ ${wrongPairs.length} неверно`
            : `✗ ${wrongPairs.length} неверно`;
        feedback.className = "feedback error";
    }

    updateScoreDisplay();
    updateProgress();

    setTimeout(() => {
        document.querySelectorAll(".answer-slot").forEach(s => s.classList.remove("correct", "incorrect"));

        wrongPairs.forEach(pair => {
            const minPos = Math.max(1, Math.ceil(pairQueue.length / 2));
            const pos    = minPos + Math.floor(Math.random() * (pairQueue.length - minPos + 1));
            pairQueue.splice(pos, 0, pair);
        });

        saveProgress();
        loadQuestion();
    }, 900);
};

// ============================================================
// Всплывающий +2 над блоком счёта
// ============================================================
function showDelta(text) {
    const d = document.createElement("div");
    d.className   = "score-delta score-delta--pos";
    d.textContent = text;
    document.querySelector(".score-block").appendChild(d);
    d.addEventListener("animationend", () => d.remove());
}

// ============================================================
// Сбросить — пропустить без проверки
// ============================================================
resetBtn.onclick = () => {
    if (isChecking) return;
    if (currentQuestion) {
        currentQuestion.pairs.forEach(pair => pairQueue.push(pair));
        saveProgress();
    }
    loadQuestion();
};

// ============================================================
// Прогресс и счёт
// ============================================================
function updateProgress() {
    progressText.textContent = `${solvedCount} из ${totalPairs}`;
    const pct = totalPairs > 0 ? Math.round((solvedCount / totalPairs) * 100) : 0;
    progressFill.style.width = pct + "%";
}

function updateScoreDisplay() {
    if (scoreValue) scoreValue.textContent = formatScore(score);
}

// ============================================================
// Навигация: выбрать другой тренажёр
// ============================================================
window.backToSelector = function () {
    // Сохраняем пары текущего вопроса обратно в очередь, чтобы они не пропали
    if (currentQuestion && currentConfig) {
        currentQuestion.pairs.forEach(pair => pairQueue.push(pair));
        saveProgress();
    }

    finishModal.classList.remove("show");
    finishModal.classList.add("hidden");
    startModal.classList.remove("hidden");
    startModal.classList.add("show");

    allPairs = []; pairQueue = []; solvedCount = 0;
    totalPairs = 0; score = 0; currentQuestion = null; currentConfig = null;
    selectedOption = null;
    quizTitle.textContent = "История";
};

// ============================================================
// Полный сброс текущего тренажёра
// ============================================================
window.resetProgress = function () {
    if (currentConfig) localStorage.removeItem(currentConfig.storageKey);
    location.reload();
};

});
