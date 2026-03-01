document.addEventListener("DOMContentLoaded", () => {

const STORAGE_KEY = "historyQuizProgress";

const startModal = document.getElementById("start-modal");
const finishModal = document.getElementById("finish-modal");
const startBtn = document.getElementById("start-btn");
const finalText = document.getElementById("final-text");

const eventsList = document.getElementById("events-list");
const answersSlots = document.getElementById("answers-slots");
const optionsGrid = document.getElementById("options-grid");
const checkBtn = document.getElementById("check-btn");
const resetBtn = document.getElementById("reset-btn");
const feedback = document.getElementById("feedback");

const questionNumber = document.getElementById("question-number");
const questionDescription = document.getElementById("question-description");

const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");

let data = null;        // сюда загрузим JSON
let queue = [];
let solved = 0;
let userAnswers = {};
let currentQuestion = null;

// --- старт: показываем модалку сразу ---
startBtn.onclick = async () => {
    startModal.classList.remove("show");
    startModal.classList.add("hidden");

    // Загружаем вопросы асинхронно после нажатия
    if (!data) {
        try {
            const res = await fetch("data/questions.json");
            data = await res.json();
        } catch (err) {
            console.error("Ошибка загрузки JSON:", err);
            alert("Не удалось загрузить вопросы. Попробуйте обновить страницу.");
            return;
        }
    }

    // Загружаем прогресс из localStorage
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    queue = saved?.queue || [...data.questions];
    solved = saved?.solved || 0;

    updateProgress();
    loadQuestion();
};

// --- сохранение прогресса ---
function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({queue, solved}));
}

// --- выбираем случайный вопрос ---
function getRandomQuestion() {
    if (queue.length === 0) return null;
    const index = Math.floor(Math.random() * queue.length);
    currentQuestion = queue[index];
    currentQuestion.indexInQueue = index;
    return currentQuestion;
}

// --- загрузка вопроса на страницу ---
function loadQuestion() {
    const q = getRandomQuestion();

    if (!q) {
        finalText.textContent = `Вы решили ${solved} из ${data.questions.length}`;
        finishModal.classList.remove("hidden");
        finishModal.classList.add("show");
        updateProgress();
        return;
    }

    userAnswers = {};
    feedback.textContent = "";
    checkBtn.disabled = true;

    questionNumber.textContent = `Задание №${q.number}`;
    questionDescription.textContent = q.description;

    eventsList.innerHTML = "";
    answersSlots.innerHTML = "";
    optionsGrid.innerHTML = "";

    q.events.forEach((e, i) => {
        eventsList.innerHTML += `<div class="event-item">${i + 1}. ${e.text}</div>`;
        answersSlots.innerHTML += `<div class="answer-slot" data-index="${i}">Перетащите сюда</div>`;
    });

    [...q.participants].sort(() => Math.random() - 0.5)
      .forEach(p => {
          optionsGrid.innerHTML += `<div class="option" draggable="true" data-id="${p.id}">${p.text}</div>`;
      });

    setupDnD(q);
    updateProgress();
}

// --- Drag & Drop ---
function setupDnD(q) {
    document.querySelectorAll(".option").forEach(opt => {
        opt.addEventListener("dragstart", e => {
            e.dataTransfer.setData("id", opt.dataset.id);
            e.dataTransfer.setData("text", opt.textContent);
        });
    });

    document.querySelectorAll(".answer-slot").forEach(slot => {
        slot.addEventListener("dragover", e => e.preventDefault());
        slot.addEventListener("drop", e => {
            e.preventDefault();
            const id = e.dataTransfer.getData("id");
            const text = e.dataTransfer.getData("text");
            const index = slot.dataset.index;

            if (userAnswers[index]) {
                const oldId = userAnswers[index];
                document.querySelector(`[data-id="${oldId}"]`)?.classList.remove("used");
            }

            userAnswers[index] = id;
            slot.textContent = text;
            slot.classList.add("filled");
            document.querySelector(`[data-id="${id}"]`).classList.add("used");

            if (Object.keys(userAnswers).length === q.events.length) {
                checkBtn.disabled = false;
            }
        });
    });
}

// --- проверка ответа ---
checkBtn.onclick = () => {
    const q = currentQuestion;
    let correct = true;

    Object.keys(q.correctMatches).forEach(i => {
        const slot = document.querySelector(`.answer-slot[data-index="${i}"]`);
        if (userAnswers[i] !== q.correctMatches[i]) {
            correct = false;
            slot.classList.add("incorrect");
        } else {
            slot.classList.add("correct");
        }
    });

    if (correct) {
        feedback.textContent = "Правильно!";
        feedback.classList.add("success");

        solved++;
        queue.splice(q.indexInQueue, 1);
        saveProgress();
        updateProgress();

        setTimeout(() => {
            document.querySelectorAll(".answer-slot").forEach(s => s.classList.remove("correct"));
            loadQuestion();
        }, 800);

    } else {
        feedback.textContent = "Неправильно!";
        feedback.classList.remove("success");
        feedback.classList.add("fade");

        saveProgress();

        setTimeout(() => {
            document.querySelectorAll(".answer-slot").forEach(s => s.classList.remove("incorrect"));
            feedback.classList.remove("fade");
            loadQuestion();
        }, 800);
    }
};

// --- сброс текущего вопроса ---
resetBtn.onclick = () => loadQuestion();

// --- обновление прогресс-бара ---
function updateProgress() {
    if (!data) return;
    progressText.textContent = `${solved} из ${data.questions.length}`;
    const percent = Math.round((solved / data.questions.length) * 100);
    progressFill.style.width = percent + "%";
}

// --- сброс всего прогресса ---
window.resetProgress = function() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
};
});