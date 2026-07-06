// ============================================================
// 瘟疫危机 卡牌游戏 - 游戏引擎
// ============================================================

// ==================== 工具函数 ====================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function $(id) { return document.getElementById(id); }

// 计算整数二进制中1的个数（popcount）
function countBits(n) {
    let c = 0;
    while (n) { c++; n &= n - 1; }
    return c;
}

// ==================== 游戏状态 ====================

const G = {
    deck: [],
    playerHand: [],
    computerHand: [],
    difficulty: 'normal',
    phase: 'init',        // init | player_attack | computer_defend | computer_attack | player_defend | player_quiz | game_over
    attacker: 'player',
    activeDisease: null,   // 当前需要应对的疾病卡
    playerSelected: [],    // 玩家选中的卡牌id数组
    battleAttack: [],      // 对战区攻击卡
    battleDefend: [],      // 对战区防御卡
    quizDisease: null,     // 当前问答对应的疾病名
    quizTreatment: null,   // 玩家选的治疗方法选项index
    quizSymptoms: [],      // 玩家选的症状选项index数组
    quizStep: 1,           // 当前问答步骤：1=治疗方法, 2=症状
    isProcessing: false,   // 防止重复点击
};

// ==================== 初始化 ====================

function startGame(difficulty) {
    G.difficulty = difficulty;
    G.deck = shuffle(createDeck());
    G.playerHand = [];
    G.computerHand = [];
    G.phase = 'init';
    G.attacker = 'player';
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.isProcessing = false;

    // 发牌: 各5张
    for (let i = 0; i < 5; i++) {
        G.playerHand.push(G.deck.pop());
        G.computerHand.push(G.deck.pop());
    }

    // 隐藏弹窗
    closeModal('difficulty-modal');
    closeModal('quiz-modal');
    closeModal('gameover-modal');

    // 清空日志
    $('battle-log').innerHTML = '';

    // 更新难度徽章
    const badge = $('difficulty-badge');
    badge.textContent = DIFFICULTY[difficulty].name;
    badge.className = 'badge ' + difficulty;

    renderAll();
    addLog('游戏开始！你为先手。', 'log-action');
    addLog(`难度：${DIFFICULTY[difficulty].name} — ${DIFFICULTY[difficulty].desc}`, 'log-info');

    // 进入第一个阶段
    phasePlayerAttack();
}

// ==================== 阶段调度 ====================

async function phasePlayerAttack() {
    if (G.phase === 'game_over') return;
    G.phase = 'player_attack';
    G.attacker = 'player';
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    renderAll();

    // 检查玩家是否有疾病卡
    if (!hasDiseaseCard(G.playerHand)) {
        const ok = await drawLoop('player', 'disease', 0);
        if (!ok) return; // 牌堆耗尽, 已判负
    }

    $('turn-indicator').innerHTML = '⚔️ <b>你的回合 — 请选择一张疾病卡攻击</b>';
    addLog('请从手牌中选择一张<b>疾病卡</b>打出。', 'log-action');
    enablePlayerSelect('disease');
}

async function phaseComputerDefend() {
    if (G.phase === 'game_over') return;
    G.phase = 'computer_defend';
    G.playerSelected = [];
    G.battleDefend = [];
    renderAll();
    disablePlayerSelect();

    const targetLevel = G.activeDisease.level;
    $('turn-indicator').textContent = '💻 电脑正在应对...';

    // 检查电脑是否能应对
    if (!canMatchLevel(G.computerHand, targetLevel)) {
        addLog('电脑无法应对，正在抽牌...', 'log-warn');
        const ok = await drawLoop('computer', 'defense', targetLevel);
        if (!ok) return;
    }

    await sleep(600);

    // 电脑选择防御牌
    const combo = findBestDefense(G.computerHand, targetLevel, G.difficulty);
    G.battleDefend = [...combo];
    // 从手牌移除
    combo.forEach(c => {
        const idx = G.computerHand.findIndex(h => h.id === c.id);
        if (idx >= 0) G.computerHand.splice(idx, 1);
    });

    const effLevel = calcEffectiveLevel(combo);
    addLog(`电脑打出 ${combo.map(c => c.name).join(' + ')}（等级 ${effLevel} ≥ ${targetLevel}）`, 'log-info');

    // 电脑展示知识(自动正确)
    const diseaseName = G.activeDisease.name;
    const kb = DISEASE_KNOWLEDGE[diseaseName];
    const correctTreatment = kb.treatment.options.find(o => o.correct).text;
    const correctSymptoms = kb.symptoms.options.filter(o => o.correct).map(o => o.text);
    addLog(`电脑回答：治疗方法是「${correctTreatment}」，症状有「${correctSymptoms.join('」和「')}」✓`, 'log-info');

    renderAll();
    await sleep(1200);

    // 检查电脑是否出完手牌
    if (checkWinAfterPlay('computer')) return;

    // 电脑防守成功，成为攻击方
    await phaseComputerAttack();
}

async function phaseComputerAttack() {
    if (G.phase === 'game_over') return;
    G.phase = 'computer_attack';
    G.attacker = 'computer';
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    renderAll();

    // 检查电脑是否有疾病卡
    if (!hasDiseaseCard(G.computerHand)) {
        addLog('电脑没有疾病卡，正在抽牌...', 'log-warn');
        const ok = await drawLoop('computer', 'disease', 0);
        if (!ok) return;
    }

    await sleep(500);

    // 电脑选择疾病卡攻击
    const card = findAttackCard(G.computerHand, G.difficulty);
    const idx = G.computerHand.findIndex(h => h.id === card.id);
    G.computerHand.splice(idx, 1);
    G.activeDisease = card;
    G.battleAttack = [card];

    $('turn-indicator').textContent = `💻 电脑打出 ${card.name}（等级 ${card.level}）`;
    addLog(`电脑打出疾病卡「<b>${card.name}</b>」（等级 ${card.level}），请应对！`, 'log-action');
    renderAll();
    await sleep(800);

    // 检查电脑是否出完手牌
    if (checkWinAfterPlay('computer')) return;

    // 轮到玩家防御
    await phasePlayerDefend();
}

async function phasePlayerDefend() {
    if (G.phase === 'game_over') return;
    G.phase = 'player_defend';
    G.playerSelected = [];
    G.battleDefend = [];
    renderAll();

    const targetLevel = G.activeDisease.level;

    // 检查玩家是否能应对
    if (!canMatchLevel(G.playerHand, targetLevel)) {
        addLog('你的手牌无法应对，正在抽牌...', 'log-warn');
        const ok = await drawLoop('player', 'defense', targetLevel);
        if (!ok) return;
    }

    $('turn-indicator').innerHTML = `🛡️ 请选择治疗卡应对 <b>${G.activeDisease.name}</b>（需 ≥${targetLevel}级）`;
    addLog(`请选择治疗卡/时间卡/疫苗，总等级需 ≥ ${targetLevel}。`, 'log-action');
    enablePlayerSelect('defense');
}

async function phasePlayerQuiz() {
    if (G.phase === 'game_over') return;
    G.phase = 'player_quiz';
    disablePlayerSelect();
    renderAll();

    const diseaseName = G.quizDisease;
    $('turn-indicator').textContent = `📝 回答问题：${diseaseName}`;

    showQuizModal(diseaseName);
    // 等待玩家提交... (由 checkQuizAnswer 继续)
}

// ==================== 玩家操作 ====================

function onPlayerCardClick(cardId) {
    if (G.isProcessing) return;
    if (G.phase !== 'player_attack' && G.phase !== 'player_defend') return;

    const hand = G.playerHand;
    const card = hand.find(c => c.id === cardId);
    if (!card) return;

    if (G.phase === 'player_attack') {
        // 只能选疾病卡，且只能选一张
        if (card.type !== 'disease') return;
        G.playerSelected = [card];
    } else if (G.phase === 'player_defend') {
        // 只能选治疗/时间/特殊卡
        if (card.type === 'disease') return;
        // 切换选择
        const idx = G.playerSelected.findIndex(c => c.id === cardId);
        if (idx >= 0) {
            G.playerSelected.splice(idx, 1);
        } else {
            // 限制每次出牌不超过3张
            if (G.playerSelected.length >= 3) {
                addLog('每次最多只能出3张牌！请取消已选卡牌后再选。', 'log-warn');
                return;
            }
            G.playerSelected.push(card);
        }
    }

    renderAll();
    updateConfirmButton();
}

function onPlayerConfirm() {
    if (G.isProcessing) return;
    if (G.playerSelected.length === 0) return;

    if (G.phase === 'player_attack') {
        confirmPlayerAttack();
    } else if (G.phase === 'player_defend') {
        confirmPlayerDefend();
    }
}

async function confirmPlayerAttack() {
    G.isProcessing = true;
    const card = G.playerSelected[0];
    // 从手牌移除
    const idx = G.playerHand.findIndex(c => c.id === card.id);
    G.playerHand.splice(idx, 1);
    G.activeDisease = card;
    G.battleAttack = [card];
    G.playerSelected = [];
    disablePlayerSelect();

    addLog(`你打出疾病卡「<b>${card.name}</b>」（等级 ${card.level}）`, 'log-action');
    $('turn-indicator').textContent = `你打出 ${card.name}（等级 ${card.level}）`;
    renderAll();
    await sleep(600);

    // 检查玩家是否出完手牌
    if (checkWinAfterPlay('player')) { G.isProcessing = false; return; }

    G.isProcessing = false;
    await phaseComputerDefend();
}

async function confirmPlayerDefend() {
    const targetLevel = G.activeDisease.level;
    const effLevel = calcEffectiveLevel(G.playerSelected);

    if (effLevel < targetLevel) {
        addLog(`总等级 ${effLevel} 不足 ${targetLevel}，请选择更多卡牌。`, 'log-warn');
        return;
    }

    G.isProcessing = true;
    G.battleDefend = [...G.playerSelected];
    // 从手牌移除选中的卡
    G.playerSelected.forEach(c => {
        const idx = G.playerHand.findIndex(h => h.id === c.id);
        if (idx >= 0) G.playerHand.splice(idx, 1);
    });
    G.playerSelected = [];
    disablePlayerSelect();

    const hasVaccine = G.battleDefend.some(c => c.type === 'special');
    const vaccineNote = hasVaccine ? '（疫苗翻倍！）' : '';
    addLog(`你打出 ${G.battleDefend.map(c => c.name).join(' + ')}，有效等级 ${effLevel} ${vaccineNote}`, 'log-action');
    $('turn-indicator').textContent = `你的应对等级: ${effLevel} ≥ ${targetLevel} ✓`;
    renderAll();
    await sleep(600);

    // 检查玩家是否出完手牌
    if (checkWinAfterPlay('player')) { G.isProcessing = false; return; }

    // 进入知识问答
    G.quizDisease = G.activeDisease.name;
    G.isProcessing = false;
    await phasePlayerQuiz();
}

// ==================== 知识问答 ====================

function showQuizModal(diseaseName) {
    const kb = DISEASE_KNOWLEDGE[diseaseName];
    if (!kb) {
        // 没有知识库数据，直接通过
        addLog(`（${diseaseName} 知识库数据缺失，自动通过）`, 'log-warn');
        onQuizPass();
        return;
    }

    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;

    $('quiz-disease-name').textContent = `📋 ${diseaseName} 知识问答`;
    $('quiz-treatment-q').textContent = kb.treatment.question;
    $('quiz-symptom-q').textContent = kb.symptoms.question;

    // 渲染治疗选项 (单选)
    const tContainer = $('quiz-treatment-options');
    tContainer.innerHTML = '';
    kb.treatment.options.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'quiz-option';
        div.textContent = opt.text;
        div.addEventListener('click', () => selectQuizTreatment(i));
        tContainer.appendChild(div);
    });

    // 渲染症状选项 (多选, 最多2项)
    const sContainer = $('quiz-symptom-options');
    sContainer.innerHTML = '';
    kb.symptoms.options.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'quiz-option';
        div.textContent = opt.text;
        div.addEventListener('click', () => selectQuizSymptom(i));
        sContainer.appendChild(div);
    });

    // 步骤1：显示治疗方法，隐藏症状
    $('quiz-step1').style.display = '';
    $('quiz-step2').style.display = 'none';
    $('quiz-step1-btn').disabled = true;
    $('quiz-hint1').textContent = '请选择1个治疗方法';
    updateQuizStepIndicator(1);
    openModal('quiz-modal');
}

function selectQuizTreatment(index) {
    if (G.phase !== 'player_quiz') return;
    if (G.quizStep !== 1) return;
    G.quizTreatment = index;
    // 更新UI高亮
    const options = $('quiz-treatment-options').children;
    Array.from(options).forEach((el, i) => el.classList.toggle('selected', i === index));
    // 启用"下一步"按钮
    $('quiz-step1-btn').disabled = false;
    $('quiz-hint1').textContent = '已选择，点击下一步';
}

// 步骤1→步骤2：治疗方法选好后，进入症状选择
function goToQuizStep2() {
    if (G.quizTreatment === null) return;
    G.quizStep = 2;
    $('quiz-step1').style.display = 'none';
    $('quiz-step2').style.display = '';
    $('quiz-step2-btn').disabled = true;
    $('quiz-hint2').textContent = '请选择2个症状';
    updateQuizStepIndicator(2);
}

// 更新步骤指示器UI
function updateQuizStepIndicator(step) {
    const dot1 = $('quiz-step-dot1');
    const dot2 = $('quiz-step-dot2');
    dot1.classList.toggle('active', step === 1);
    dot1.classList.toggle('done', step > 1);
    dot2.classList.toggle('active', step === 2);
}

function selectQuizSymptom(index) {
    if (G.phase !== 'player_quiz') return;
    if (G.quizStep !== 2) return;
    const idx = G.quizSymptoms.indexOf(index);
    if (idx >= 0) {
        G.quizSymptoms.splice(idx, 1);
    } else if (G.quizSymptoms.length < 2) {
        G.quizSymptoms.push(index);
    }
    // 更新UI高亮
    const options = $('quiz-symptom-options').children;
    Array.from(options).forEach((el, i) => el.classList.toggle('selected', G.quizSymptoms.includes(i)));
    updateQuizSubmit();
}

function updateQuizSubmit() {
    const ready = G.quizSymptoms.length === 2;
    $('quiz-step2-btn').disabled = !ready;
    if (ready) {
        $('quiz-hint2').textContent = '已选择完毕，请提交答案';
    } else {
        $('quiz-hint2').textContent = `还需选择：${G.quizSymptoms.length}/2个症状`;
    }
}

async function onQuizSubmit() {
    if (G.isProcessing) return;
    if (G.phase !== 'player_quiz') return;
    if (G.quizStep !== 2) return;
    if (G.quizTreatment === null || G.quizSymptoms.length !== 2) return;
    G.isProcessing = true;

    const diseaseName = G.quizDisease;
    const kb = DISEASE_KNOWLEDGE[diseaseName];

    const treatmentCorrect = kb.treatment.options[G.quizTreatment].correct;
    const symptomsCorrect = G.quizSymptoms.every(i => kb.symptoms.options[i].correct)
        && G.quizSymptoms.length === 2
        && kb.symptoms.options.filter((o, i) => o.correct && G.quizSymptoms.includes(i)).length === 2;

    // 显示答案（两步都高亮）
    highlightQuizAnswers(kb);

    if (treatmentCorrect && symptomsCorrect) {
        addLog('✅ 回答完全正确！轮到你出牌攻击。', 'log-action');
        await sleep(1000);
        closeModal('quiz-modal');
        onQuizPass();
    } else {
        let reason = '';
        if (!treatmentCorrect) reason += '治疗方法选错';
        if (!symptomsCorrect) reason += (reason ? '，' : '') + '症状选错';
        addLog(`❌ 回答错误（${reason}），电脑继续攻击！`, 'log-error');
        await sleep(1500);
        closeModal('quiz-modal');
        onQuizFail();
    }
}

function highlightQuizAnswers(kb) {
    // 显示步骤2（症状）以便用户看到完整结果
    $('quiz-step1').style.display = 'none';
    $('quiz-step2').style.display = '';
    updateQuizStepIndicator(2);
    // 高亮治疗选项
    Array.from($('quiz-treatment-options').children).forEach((el, i) => {
        el.classList.remove('selected');
        if (kb.treatment.options[i].correct) el.classList.add('correct');
        else if (i === G.quizTreatment && !kb.treatment.options[i].correct) el.classList.add('wrong');
    });
    // 高亮症状选项
    Array.from($('quiz-symptom-options').children).forEach((el, i) => {
        el.classList.remove('selected');
        if (kb.symptoms.options[i].correct) el.classList.add('correct');
        else if (G.quizSymptoms.includes(i) && !kb.symptoms.options[i].correct) el.classList.add('wrong');
    });
    $('quiz-step2-btn').style.display = 'none';
    $('quiz-hint2').textContent = '答案已显示';
}

async function onQuizPass() {
    G.phase = 'player_attack';
    G.attacker = 'player';
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.battleAttack = [];
    G.battleDefend = [];
    G.activeDisease = null;
    G.playerSelected = [];
    G.isProcessing = false;
    renderAll();
    await sleep(400);
    await phasePlayerAttack();
}

async function onQuizFail() {
    G.phase = 'computer_attack';
    G.attacker = 'computer';
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.battleAttack = [];
    G.battleDefend = [];
    G.activeDisease = null;
    G.playerSelected = [];
    G.isProcessing = false;
    renderAll();
    await sleep(400);
    await phaseComputerAttack();
}

// ==================== 抽牌循环 ====================

async function drawLoop(who, needType, targetLevel) {
    // who: 'player' | 'computer'
    // needType: 'disease' | 'defense'

    G.isProcessing = true;
    const hand = who === 'player' ? G.playerHand : G.computerHand;
    const name = who === 'player' ? '你' : '电脑';
    const fastDelay = who === 'computer' ? 400 : 700;

    while (true) {
        // 检查条件是否满足
        if (needType === 'disease') {
            if (hasDiseaseCard(hand)) {
                addLog(`${name}抽到了疾病卡，可以攻击了。`, 'log-info');
                renderAll();
                G.isProcessing = false;
                return true;
            }
        } else if (needType === 'defense') {
            if (canMatchLevel(hand, targetLevel)) {
                addLog(`${name}抽到了足够的治疗卡！`, 'log-info');
                renderAll();
                G.isProcessing = false;
                return true;
            }
        }

        // 牌堆空 → 判负
        if (G.deck.length === 0) {
            addLog(`牌堆已空，${name}无法出牌！`, 'log-error');
            await sleep(600);
            endGame(who === 'player' ? 'computer' : 'player', 'deck_empty');
            G.isProcessing = false;
            return false;
        }

        // 抽一张牌
        const card = G.deck.pop();
        hand.push(card);
        addLog(`${name}抽到了一张牌。`, 'log-info');
        renderAll();
        await sleep(fastDelay);
    }
}

// ==================== 电脑AI ====================

function hasDiseaseCard(hand) {
    return hand.some(c => c.type === 'disease');
}

function canMatchLevel(hand, targetLevel) {
    if (targetLevel <= 0) return true;
    const usable = hand.filter(c => ['treatment', 'time', 'special'].includes(c.type));
    return findBestDefense(usable, targetLevel, 'hard') !== null;
}

function calcEffectiveLevel(cards) {
    if (cards.length === 0) return 0;
    const sum = cards.reduce((s, c) => s + c.level, 0);
    const hasVaccine = cards.some(c => c.type === 'special');
    return hasVaccine ? sum * 2 : sum;
}

function findBestDefense(hand, targetLevel, difficulty) {
    // 从hand中找最优防御组合
    const usable = hand.filter(c => ['treatment', 'time', 'special'].includes(c.type));
    const n = usable.length;
    if (n === 0) return null;

    const diff = DIFFICULTY[difficulty];
    let allCombos = [];

    // 枚举所有子集 (最多2^12=4096，实际手牌不会超过15张)
    // 限制每次出牌不超过3张
    for (let mask = 1; mask < (1 << n); mask++) {
        const subset = [];
        // 快速跳过超过3张的组合
        if (countBits(mask) > 3) continue;
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) subset.push(usable[i]);
        }
        const eff = calcEffectiveLevel(subset);
        if (eff >= targetLevel) {
            allCombos.push({ cards: subset, level: eff, count: subset.length });
        }
    }

    if (allCombos.length === 0) return null;

    if (diff.optimalDefense) {
        // 最优: 最少卡牌数，其次最低超出等级
        allCombos.sort((a, b) => {
            if (a.count !== b.count) return a.count - b.count;
            return a.level - b.level;
        });
    } else {
        // 简单难度: 随机从可行的里面选，偏向用更多卡
        allCombos.sort((a, b) => b.count - a.count);
        // 从前一半随机选
        const topN = Math.max(1, Math.ceil(allCombos.length / 2));
        const pick = allCombos.slice(0, topN);
        allCombos = [pick[Math.floor(Math.random() * pick.length)]];
    }

    // 疫苗使用概率
    const best = allCombos[0];
    const hasVaccine = best.cards.some(c => c.type === 'special');
    if (hasVaccine && Math.random() > diff.vaccineUseChance) {
        // 不用疫苗，重新找不含疫苗的最优解
        const noVaccine = allCombos.filter(c => !c.cards.some(cc => cc.type === 'special'));
        if (noVaccine.length > 0) return noVaccine[0].cards;
    }

    return best.cards;
}

function findAttackCard(hand, difficulty) {
    const diseases = hand.filter(c => c.type === 'disease');
    if (diseases.length === 0) return null;

    const diff = DIFFICULTY[difficulty];
    if (diff.attackRandom) {
        return diseases[Math.floor(Math.random() * diseases.length)];
    } else {
        // 困难/普通: 出最高等级的
        diseases.sort((a, b) => b.level - a.level);
        return diseases[0];
    }
}

// ==================== 胜负判定 ====================

function checkWinAfterPlay(who) {
    const hand = who === 'player' ? G.playerHand : G.computerHand;
    if (hand.length === 0) {
        endGame(who, 'empty_hand');
        return true;
    }
    return false;
}

function endGame(winner, reason) {
    G.phase = 'game_over';
    disablePlayerSelect();
    G.playerSelected = [];
    renderAll();

    const isPlayerWin = winner === 'player';
    $('gameover-icon').textContent = isPlayerWin ? '🎉' : '😞';
    $('gameover-title').textContent = isPlayerWin ? '恭喜，你赢了！' : '很遗憾，你输了。';
    $('gameover-title').style.color = isPlayerWin ? 'var(--green)' : 'var(--red)';

    let detail = '';
    if (reason === 'empty_hand') {
        detail = isPlayerWin ? '你打出了所有手牌！' : '电脑打出了所有手牌。';
    } else if (reason === 'deck_empty') {
        detail = '牌堆耗尽，无法继续出牌。';
    }
    $('gameover-detail').textContent = detail;
    openModal('gameover-modal');

    $('turn-indicator').textContent = isPlayerWin ? '🏆 你赢了！' : '💀 你输了...';
    addLog(isPlayerWin ? '🎉 恭喜获胜！' : '💀 败北...再来一局吧！', isPlayerWin ? 'log-action' : 'log-error');
}

// ==================== UI渲染 ====================

function renderAll() {
    renderHand('computer');
    renderHand('player');
    renderBattle();
    renderDeckCount();
    renderCardCounts();
}

function renderHand(who) {
    const hand = who === 'player' ? G.playerHand : G.computerHand;
    const container = who === 'player' ? $('player-hand') : $('computer-hand');
    container.innerHTML = '';

    if (who === 'computer') {
        // 电脑手牌显示背面
        hand.forEach((card, i) => {
            const div = document.createElement('div');
            div.className = 'card card-back';
            div.style.animationDelay = `${i * 0.03}s`;
            div.innerHTML = '<div class="card-back-inner">🂠</div>';
            container.appendChild(div);
        });
    } else {
        // 玩家手牌显示正面
        hand.forEach((card, i) => {
            const div = document.createElement('div');
            div.className = `card ${card.type}`;
            div.style.animationDelay = `${i * 0.03}s`;
            div.classList.add('anim-draw');

            // 不可选类型变暗
            const canSelect = canPlayerSelectCard(card);
            if (!canSelect) div.style.opacity = '0.45';

            // 已选中高亮
            const isSelected = G.playerSelected.some(c => c.id === card.id);
            if (isSelected) div.classList.add('selected');

            div.addEventListener('click', () => onPlayerCardClick(card.id));
            div.innerHTML = `
                <span class="card-type-badge">${typeLabel(card.type)}</span>
                <img src="${card.image}" alt="${card.name}">
                <div class="card-info">
                    <span class="card-name">${card.name}</span>
                    <span class="card-level">Lv.${card.level}</span>
                </div>
            `;
            container.appendChild(div);
        });
    }

    // 更新已选卡牌区域
    if (who === 'player') {
        const selContainer = $('selected-list');
        selContainer.innerHTML = '';
        G.playerSelected.forEach(card => {
            const div = document.createElement('div');
            div.className = `card ${card.type}`;
            div.innerHTML = `
                <span class="card-type-badge">${typeLabel(card.type)}</span>
                <img src="${card.image}" alt="${card.name}">
                <div class="card-info">
                    <span class="card-name">${card.name}</span>
                    <span class="card-level">Lv.${card.level}</span>
                </div>
            `;
            selContainer.appendChild(div);
        });

        // 显示总等级
        if (G.phase === 'player_defend' && G.playerSelected.length > 0) {
            const eff = calcEffectiveLevel(G.playerSelected);
            const hasV = G.playerSelected.some(c => c.type === 'special');
            const label = selContainer.parentElement.querySelector('.selected-label');
            if (label) {
                label.textContent = `已选（总等级: ${eff}${hasV ? ' 疫苗×2' : ''}）：`;
            }
        } else if (G.phase === 'player_attack' && G.playerSelected.length > 0) {
            const label = selContainer.parentElement.querySelector('.selected-label');
            if (label) label.textContent = '已选攻击卡：';
        } else {
            const label = selContainer.parentElement.querySelector('.selected-label');
            if (label) label.textContent = '已选待出：';
        }
    }
}

function canPlayerSelectCard(card) {
    if (G.phase === 'player_attack') {
        return card.type === 'disease';
    } else if (G.phase === 'player_defend') {
        return card.type !== 'disease';
    }
    return false;
}

function typeLabel(type) {
    const map = { disease: '疾病', treatment: '治疗', time: '时间', special: '特殊' };
    return map[type] || type;
}


function renderBattle() {
    const attackSlot = document.querySelector('#slot-attack .slot-cards');
    const defendSlot = document.querySelector('#slot-defend .slot-cards');

    attackSlot.innerHTML = '';
    defendSlot.innerHTML = '';

    G.battleAttack.forEach(card => {
        const div = document.createElement('div');
        div.className = `card card-sm ${card.type} anim-play`;
        div.innerHTML = `
            <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
            <div class="card-info"><span class="card-name">${card.name}</span></div>
        `;
        attackSlot.appendChild(div);
    });

    G.battleDefend.forEach(card => {
        const div = document.createElement('div');
        div.className = `card card-sm ${card.type} anim-play`;
        div.innerHTML = `
            <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
            <div class="card-info"><span class="card-name">${card.name}</span></div>
        `;
        defendSlot.appendChild(div);
    });

    // VS动画
    const vsEl = document.querySelector('.battle-vs');
    if (G.battleAttack.length > 0 && G.battleDefend.length > 0) {
        vsEl.classList.add('pulse');
    } else {
        vsEl.classList.remove('pulse');
    }
}

function renderDeckCount() {
    $('deck-count').textContent = `剩余: ${G.deck.length}`;
}

function renderCardCounts() {
    $('player-card-count').textContent = `手牌: ${G.playerHand.length}`;
    $('computer-card-count').textContent = `手牌: ${G.computerHand.length}`;
}

function enablePlayerSelect(mode) {
    // mode: 'disease' | 'defense'
    $('btn-confirm').style.display = 'inline-block';
    const btn = $('btn-confirm');
    if (mode === 'defense') {
        btn.textContent = '请选择治疗卡（最多3张）';
    }
    updateConfirmButton();
}

function disablePlayerSelect() {
    G.playerSelected = [];
    $('btn-confirm').disabled = true;
    $('btn-confirm').style.display = 'none';
    renderAll();
}

function updateConfirmButton() {
    const btn = $('btn-confirm');
    btn.style.display = 'inline-block';

    if (G.phase === 'player_attack') {
        btn.disabled = G.playerSelected.length !== 1;
        btn.textContent = G.playerSelected.length === 1 ? `确认出牌: ${G.playerSelected[0].name}` : '请选择一张疾病卡';
    } else if (G.phase === 'player_defend') {
        if (G.playerSelected.length === 0) {
            btn.disabled = true;
            btn.textContent = '请选择治疗卡（最多3张）';
        } else {
            const eff = calcEffectiveLevel(G.playerSelected);
            const target = G.activeDisease ? G.activeDisease.level : 0;
            btn.disabled = eff < target;
            btn.textContent = eff >= target
                ? `确认出牌 (${G.playerSelected.length}/3张, 等级 ${eff} ≥ ${target})`
                : `等级不足 (${G.playerSelected.length}/3张, ${eff} < ${target})`;
        }
    }
}

// 微信内置浏览器滚动穿透修复
// 注意：滚动在 .modal 自身（display:block + overflow-y:auto），不是 .modal-content
// 微信端仅 CSS overflow:hidden 无法阻止 body 背景滚动，必须 JS 拦截 body 的 touchmove

function lockBodyScroll(lock) {
    if (lock) {
        document.body.classList.add('modal-open');
        document.body.addEventListener('touchmove', preventBodyScroll, { passive: false });
    } else {
        document.body.classList.remove('modal-open');
        document.body.removeEventListener('touchmove', preventBodyScroll, { passive: false });
    }
}

function preventBodyScroll(e) {
    e.preventDefault();
}

function openModal(id) {
    $(id).classList.add('show');
    lockBodyScroll(true);
}

function closeModal(id) {
    $(id).classList.remove('show');
    if (!document.querySelector('.modal.show')) {
        lockBodyScroll(false);
    }
}

function addLog(msg, cls) {
    const log = $('battle-log');
    const p = document.createElement('p');
    p.className = cls || '';
    p.innerHTML = msg;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;

    // 保留最近20条
    while (log.children.length > 20) {
        log.removeChild(log.firstChild);
    }
}

// ==================== 事件绑定 ====================

document.addEventListener('DOMContentLoaded', () => {
    // 难度选择
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const diff = btn.dataset.diff;
            startGame(diff);
        });
    });

    // 确认出牌
    $('btn-confirm').addEventListener('click', onPlayerConfirm);

    // 问答步骤按钮
    $('quiz-step1-btn').addEventListener('click', goToQuizStep2);
    $('quiz-step2-btn').addEventListener('click', onQuizSubmit);

    // 重新开始
    $('gameover-restart').addEventListener('click', () => {
        closeModal('gameover-modal');
        openModal('difficulty-modal');
    });
    $('btn-restart').addEventListener('click', () => {
        if (G.phase !== 'game_over' && G.phase !== 'init') {
            if (!confirm('确定要重新开始吗？当前进度将丢失。')) return;
        }
        closeModal('gameover-modal');
        openModal('difficulty-modal');
        G.phase = 'init';
        disablePlayerSelect();
        $('battle-log').innerHTML = '<p class="log-placeholder">请选择难度开始游戏。</p>';
        $('turn-indicator').textContent = '等待开始...';
        G.battleAttack = [];
        G.battleDefend = [];
        renderAll();
    });

    // 初始显示难度选择
    openModal('difficulty-modal');
    $('btn-confirm').style.display = 'none';
    renderAll();
});
