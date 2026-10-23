(() => {
  const elements = {
    startView: document.getElementById('viewStart'),
    examView: document.getElementById('viewExam'),
    resultView: document.getElementById('viewResult'),
    dataInput: document.getElementById('dataInput'),
    pasteBtn: document.getElementById('pasteBtn'),
    startTestBtn: document.getElementById('startTestBtn'),
    examTitleDisplay: document.getElementById('examTitleDisplay'),
    questionCounter: document.getElementById('questionCounter'),
    sequencerProgress: document.getElementById('sequencerProgress'),
    sequencerState: document.getElementById('sequencerState'),
    sequencerMessage: document.getElementById('sequencerMessage'),
    masterPlayBtn: document.getElementById('masterPlayBtn'),
    questionArea: document.getElementById('questionArea'),
    prevQBtn: document.getElementById('prevQBtn'),
    nextQBtn: document.getElementById('nextQBtn'),
    submitTestBtn: document.getElementById('submitTestBtn'),
    scoreDisplay: document.getElementById('scoreDisplay'),
    resultList: document.getElementById('resultList'),
    returnTopBtn: document.getElementById('returnTopBtn'),
    toggleDoubtBtn: document.getElementById('toggleDoubtBtn'),
    loginOverlay: document.getElementById('loginOverlay'),
    userIdInput: document.getElementById('userIdInput'),
    loginBtn: document.getElementById('loginBtn'),
    accountStatusPill: document.getElementById('accountStatusPill'),
    planDisplay: document.getElementById('planDisplay'),
    creditDisplay: document.getElementById('creditDisplay'),
    settingsBtn: document.getElementById('settingsBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    settingAutoLogin: document.getElementById('settingAutoLogin'),
    settingSpeed: document.getElementById('settingSpeed'),
    settingSpeedVal: document.getElementById('settingSpeedVal'),
    globalSpeed: document.getElementById('globalSpeed'),
    globalSpeedVal: document.getElementById('globalSpeedVal'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    reviewModal: document.getElementById('reviewModal'),
    reviewModalTitle: document.getElementById('reviewModalTitle'),
    reviewModalIcon: document.getElementById('reviewModalIcon'),
    reviewScriptArea: document.getElementById('reviewScriptArea'),
    closeReviewBtn: document.getElementById('closeReviewBtn'),
    reviewPlayAllBtn: document.getElementById('reviewPlayAllBtn'),
    toast: document.getElementById('toast')
  };

  const DEFAULT_QUESTIONS = [
    {
      prompt: 'Good morning. I would like a coffee and a sandwich, please.',
      choices: [
        'A coffee and a sandwich, please.',
        'I am leaving now.',
        'The train is late.',
        'I do not like tea.'
      ],
      answerIndex: 0,
      explanation: 'This is the most natural response to a café order.'
    },
    {
      prompt: 'Could you repeat that more slowly?',
      choices: [
        'Sure, I can say it again more slowly.',
        'It is already very fast.',
        'I am in the bus station.',
        'We should leave now.'
      ],
      answerIndex: 0,
      explanation: 'The response politely asks for slower speech.'
    },
    {
      prompt: 'I am running 10 minutes late because of traffic.',
      choices: [
        'I am sorry, I am delayed by traffic.',
        'Please bring me the menu.',
        'I will call you tomorrow.',
        'This is my favorite book.'
      ],
      answerIndex: 0,
      explanation: 'It naturally acknowledges the delay and the reason.'
    },
    {
      prompt: 'Please check the battery level before we leave.',
      choices: [
        'Let us confirm the battery level first.',
        'The weather is sunny today.',
        'I cannot hear anything.',
        'The meeting is at midnight.'
      ],
      answerIndex: 0,
      explanation: 'This is the correct summary of the instruction.'
    }
  ];

  const state = {
    userId: localStorage.getItem('listeningProUserId') || 'guest',
    autoLogin: localStorage.getItem('listeningProAutoLogin') !== 'false',
    speed: Number(localStorage.getItem('listeningProSpeed') || '1.0'),
    questions: [],
    currentIndex: 0,
    answers: [],
    doubtFlags: [],
    score: 0,
    userPlan: 'Free',
    credits: 20,
    loadedUsers: new Map()
  };

  function setSpeedValue(value) {
    const safe = Math.min(1.8, Math.max(0.7, Number(value) || 1));
    state.speed = safe;
    localStorage.setItem('listeningProSpeed', String(safe));
    elements.globalSpeed.value = String(safe);
    elements.settingSpeed.value = String(safe);
    elements.globalSpeedVal.textContent = `${safe.toFixed(1)}x`;
    elements.settingSpeedVal.textContent = `${safe.toFixed(1)}x`;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      elements.toast.classList.remove('show');
    }, 1800);
  }

  function setView(viewName) {
    const map = {
      start: elements.startView,
      exam: elements.examView,
      result: elements.resultView
    };

    Object.entries(map).forEach(([name, node]) => {
      node.classList.toggle('hidden', name !== viewName);
    });
  }

  function updateAccountStatus() {
    const pill = elements.accountStatusPill;
    const plan = state.userPlan || 'Free';
    const credits = Number(state.credits || 0);

    elements.planDisplay.textContent = plan;
    elements.creditDisplay.textContent = String(credits);

    pill.classList.toggle('hidden', !state.userId || !state.userId.trim());
  }

  function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    cells.push(current);
    return cells.map((cell) => cell.trim());
  }

  async function loadUsersCsv() {
    try {
      const response = await fetch('./data/users.csv');
      if (!response.ok) return;
      const text = await response.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = parseCsvLine(lines[0] || '');
      const indexById = headers.indexOf('ID');
      const indexByCredits = headers.indexOf('Credits');
      const indexByPlan = headers.indexOf('Plan');

      if (indexById === -1) return;

      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseCsvLine(lines[i]);
        const id = cells[indexById] || '';
        if (!id) continue;
        const credits = Number(cells[indexByCredits] || '0');
        const plan = (cells[indexByPlan] || 'Free').trim() || 'Free';
        state.loadedUsers.set(id, { credits, plan });
      }
    } catch (error) {
      console.warn('Could not load users.csv', error);
    }
  }

  function loginUser(rawId) {
    const userId = String(rawId || '').trim();
    if (!userId) {
      showToast('ユーザーIDを入力してください');
      return;
    }

    const userRecord = state.loadedUsers.get(userId) || { credits: 20, plan: 'Free' };
    state.userId = userId;
    state.userPlan = userRecord.plan || 'Free';
    state.credits = Number(userRecord.credits || 0);

    localStorage.setItem('listeningProUserId', userId);
    elements.userIdInput.value = userId;
    updateAccountStatus();
    elements.loginOverlay.classList.add('hidden');
    showToast(`ようこそ、${userId} さん`);
  }

  function logoutUser() {
    state.userId = 'guest';
    state.userPlan = 'Free';
    state.credits = 20;
    localStorage.removeItem('listeningProUserId');
    updateAccountStatus();
    elements.loginOverlay.classList.remove('hidden');
    elements.userIdInput.value = '';
    showToast('ゲストモードで再開しました');
  }

  function ensureAutoLoginFlag() {
    localStorage.setItem('listeningProAutoLogin', state.autoLogin ? 'true' : 'false');
  }

  function decodeBase64Maybe(value) {
    try {
      const normalized = value.replace(/\s+/g, '');
      if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) return null;
      const decoded = atob(normalized);
      return decoded;
    } catch (error) {
      return null;
    }
  }

  function buildQuestionsFromSource(rawText) {
    const cleaned = String(rawText || '').trim();
    if (!cleaned) return DEFAULT_QUESTIONS.map((question, index) => ({ ...question, prompt: `${index + 1}. ${question.prompt}` }));

    const base64Text = decodeBase64Maybe(cleaned);
    const sourceText = base64Text && base64Text.trim() ? base64Text : cleaned;
    const lines = sourceText
      .split(/\r?\n|\.|\?|!|\u3002|\uff1f|\uff01/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);

    if (!lines.length) return DEFAULT_QUESTIONS;

    return lines.map((sentence, index) => {
      const safeSentence = sentence.replace(/\s+/g, ' ');
      const choices = [
        safeSentence,
        index % 2 === 0 ? 'Please wait for a moment.' : 'Could you say that again?',
        index % 3 === 0 ? 'I am not sure.' : 'Let us continue.',
        index % 4 === 0 ? 'That sounds correct.' : 'I understand now.'
      ];

      return {
        prompt: safeSentence,
        choices: choices.slice(0, 4),
        answerIndex: 0,
        explanation: 'この文は入力された音声テキストから生成されました。'
      };
    });
  }

  function renderQuestion() {
    const question = state.questions[state.currentIndex];
    if (!question) return;

    elements.questionArea.innerHTML = '';

    const prompt = document.createElement('p');
    prompt.textContent = question.prompt;
    elements.questionArea.appendChild(prompt);

    const list = document.createElement('div');
    list.className = 'choice-list';

    question.choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-item';
      if (state.answers[state.currentIndex] === index) button.classList.add('selected');

      const radio = document.createElement('span');
      radio.className = 'choice-radio';
      const dot = document.createElement('span');
      dot.className = 'choice-dot';
      radio.appendChild(dot);

      const text = document.createElement('span');
      text.className = 'choice-text';
      text.textContent = choice;

      button.appendChild(radio);
      button.appendChild(text);
      button.addEventListener('click', () => {
        state.answers[state.currentIndex] = index;
        renderQuestion();
      });
      list.appendChild(button);
    });

    elements.questionArea.appendChild(list);

    const current = state.currentIndex + 1;
    const total = state.questions.length;
    elements.questionCounter.textContent = `${current}/${total}`;
    const progress = ((current / total) * 100) || 0;
    elements.sequencerProgress.style.width = `${progress}%`;
    elements.sequencerState.textContent = 'ACTIVE';
    elements.sequencerMessage.textContent = `▶️ 問題 ${current} / ${total}`;

    const hasAnswer = Number.isInteger(state.answers[state.currentIndex]);
    elements.submitTestBtn.classList.toggle('hidden', current < total || !hasAnswer);
    elements.nextQBtn.textContent = state.currentIndex === total - 1 ? '終了' : '次へ ▶';
    elements.prevQBtn.disabled = state.currentIndex === 0;
    elements.toggleDoubtBtn.classList.toggle('active', !!state.doubtFlags[state.currentIndex]);
    elements.toggleDoubtBtn.setAttribute('aria-label', state.doubtFlags[state.currentIndex] ? '疑問あり' : '疑問なし');
  }

  function playText(text) {
    if (!('speechSynthesis' in window)) {
      showToast('この端末では音声再生が利用できません');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = state.speed;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => {
      elements.sequencerState.textContent = 'READY';
      elements.sequencerMessage.textContent = '▶️ 音声を再生して開始';
    };
    elements.sequencerState.textContent = 'PLAYING';
    elements.sequencerMessage.textContent = '▶️ 再生中';
    window.speechSynthesis.speak(utterance);
  }

  function playCurrentQuestion() {
    const question = state.questions[state.currentIndex];
    if (!question) return;
    playText(question.prompt);
  }

  function startExamFromText(rawText) {
    const questions = buildQuestionsFromSource(rawText);
    state.questions = questions;
    state.answers = new Array(questions.length).fill(undefined);
    state.doubtFlags = new Array(questions.length).fill(false);
    state.currentIndex = 0;
    state.score = 0;

    elements.examTitleDisplay.textContent = 'Listening Test';
    setView('exam');
    renderQuestion();
    if (questions.length) {
      playText(questions[0].prompt);
    }
  }

  function handleNextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
      return;
    }

    const answeredCount = state.answers.filter((answer) => Number.isInteger(answer)).length;
    if (answeredCount !== state.questions.length) {
      showToast('すべての問題に回答してください');
      return;
    }

    submitTest();
  }

  function handlePreviousQuestion() {
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  }

  function submitTest() {
    const total = state.questions.length || 1;
    let correct = 0;

    state.questions.forEach((question, index) => {
      if (state.answers[index] === question.answerIndex) {
        correct += 1;
      }
    });

    state.score = Math.round((correct / total) * 100);
    elements.scoreDisplay.textContent = String(state.score);

    elements.resultList.innerHTML = '';
    state.questions.forEach((question, index) => {
      const item = document.createElement('li');
      item.className = 'result-item';
      item.innerHTML = `
        <span class="result-icon">${state.answers[index] === question.answerIndex ? '✅' : '❌'}</span>
        <span>Q${index + 1}</span>
      `;
      item.addEventListener('click', () => {
        openReviewModal(index);
      });
      elements.resultList.appendChild(item);
    });

    setView('result');
    showToast(`採点結果: ${state.score} 点`);
  }

  function openReviewModal(startIndex = 0) {
    const modal = elements.reviewModal;
    modal.classList.remove('hidden');
    modal.classList.add('open');
    elements.reviewModalTitle.textContent = '復習';
    elements.reviewModalIcon.textContent = '◯';

    const reviewMarkup = state.questions
      .map((question, index) => {
        const chosen = state.answers[index];
        const isCorrect = chosen === question.answerIndex;
        const statusClass = isCorrect ? 'correct' : chosen === undefined ? 'neutral' : 'wrong';
        const chosenLabel = Number.isInteger(chosen) ? question.choices[chosen] : '未回答';
        const correctLabel = question.choices[question.answerIndex];

        return `
          <div class="review-card">
            <div class="review-answers">
              <div class="answer-chip ${statusClass}">
                ${isCorrect ? '正解' : chosen === undefined ? '未回答' : '不正解'}
              </div>
              <div class="answer-chip neutral">あなたの回答: ${chosenLabel}</div>
              <div class="answer-chip correct">正解: ${correctLabel}</div>
            </div>
            <div class="review-line">
              <div class="review-avatar">Q${index + 1}</div>
              <div class="review-bubble ${index === startIndex ? 'active' : ''}">
                <p class="en">${question.prompt}</p>
                <p class="ja">${question.explanation}</p>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    elements.reviewScriptArea.innerHTML = reviewMarkup;
  }

  function closeReviewModal() {
    elements.reviewModal.classList.remove('open');
    setTimeout(() => elements.reviewModal.classList.add('hidden'), 260);
  }

  function toggleDoubt() {
    const current = state.currentIndex;
    state.doubtFlags[current] = !state.doubtFlags[current];
    renderQuestion();
  }

  function handleUserInput() {
    const value = elements.dataInput.value.trim();
    const isReady = !!value;
    elements.startTestBtn.classList.toggle('disabled', !isReady);
    elements.startTestBtn.disabled = !isReady;
  }

  function setupControls() {
    elements.startTestBtn.disabled = true;
    elements.startTestBtn.classList.add('disabled');

    elements.dataInput.addEventListener('input', handleUserInput);
    elements.pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        elements.dataInput.value = text;
        handleUserInput();
      } catch (error) {
        showToast('クリップボードの読み取りに失敗しました');
      }
    });

    elements.startTestBtn.addEventListener('click', () => {
      startExamFromText(elements.dataInput.value);
    });

    elements.prevQBtn.addEventListener('click', handlePreviousQuestion);
    elements.nextQBtn.addEventListener('click', handleNextQuestion);
    elements.submitTestBtn.addEventListener('click', submitTest);
    elements.masterPlayBtn.addEventListener('click', playCurrentQuestion);
    elements.toggleDoubtBtn.addEventListener('click', toggleDoubt);
    elements.returnTopBtn.addEventListener('click', () => {
      state.questions = [];
      state.answers = [];
      setView('start');
      elements.dataInput.value = '';
      handleUserInput();
      showToast('トップに戻りました');
    });

    elements.loginBtn.addEventListener('click', () => {
      loginUser(elements.userIdInput.value);
    });

    elements.userIdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loginUser(elements.userIdInput.value);
    });

    elements.settingsBtn.addEventListener('click', () => {
      elements.settingsModal.classList.remove('hidden');
      elements.settingsModal.classList.add('open');
    });

    elements.closeSettingsBtn.addEventListener('click', () => {
      elements.settingsModal.classList.remove('open');
      setTimeout(() => elements.settingsModal.classList.add('hidden'), 260);
    });

    elements.closeReviewBtn.addEventListener('click', closeReviewModal);
    elements.reviewModal.addEventListener('click', (event) => {
      if (event.target === elements.reviewModal || event.target === elements.reviewModalBg) {
        closeReviewModal();
      }
    });

    elements.reviewPlayAllBtn.addEventListener('click', () => {
      const fullScript = state.questions.map((question) => question.prompt).join('. ');
      playText(fullScript);
    });

    elements.logoutBtn.addEventListener('click', logoutUser);
    elements.saveSettingsBtn.addEventListener('click', () => {
      state.autoLogin = elements.settingAutoLogin.checked;
      ensureAutoLoginFlag();
      setSpeedValue(elements.settingSpeed.value);
      elements.settingsModal.classList.remove('open');
      setTimeout(() => elements.settingsModal.classList.add('hidden'), 260);
      showToast('設定を保存しました');
    });

    elements.globalSpeed.addEventListener('input', (event) => {
      setSpeedValue(event.target.value);
    });

    elements.settingSpeed.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      setSpeedValue(value);
      elements.settingSpeedVal.textContent = `${value.toFixed(1)}x`;
    });

    elements.settingAutoLogin.checked = state.autoLogin;
    setSpeedValue(state.speed);
  }

  async function initialize() {
    await loadUsersCsv();

    if (!state.userId || state.userId === 'guest') {
      state.userId = 'guest';
      state.userPlan = 'Free';
      state.credits = 20;
      localStorage.setItem('listeningProUserId', 'guest');
      updateAccountStatus();
      elements.loginOverlay.classList.add('hidden');
    } else {
      const userRecord = state.loadedUsers.get(state.userId) || { credits: 20, plan: 'Free' };
      state.userPlan = userRecord.plan || 'Free';
      state.credits = Number(userRecord.credits || 0);
      updateAccountStatus();
      elements.loginOverlay.classList.add('hidden');
    }

    elements.settingsBtn.classList.toggle('hidden', !state.userId || state.userId === 'guest');
    elements.logoutBtn.classList.toggle('hidden', !state.userId || state.userId === 'guest');
    elements.accountStatusPill.classList.remove('hidden');
    setupControls();
    setView('start');
    showToast('Listening Pro を起動しました');
  }

  initialize();
})();
