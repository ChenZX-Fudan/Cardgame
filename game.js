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
    quizTreatmentCorrect: null, // 步骤1治疗是否答对 (null=未判定)
    isProcessing: false,   // 防止重复点击

    // ---- 联机模式 ----
    mode: 'single',            // 'single' | 'online'
    role: null,                // 'host' | 'guest' (联机时)
    peer: null,                // PeerJS 实例
    conn: null,                // DataConnection
    roomCode: '',              // 房间码 (Peer ID)
    opponentHandCount: 0,      // 对手手牌数
    _deckCount: 0,             // guest的牌堆计数（guest不知道完整牌堆）
    _pendingDrawResolve: null, // guest等待抽牌的回调
    heartbeatTimer: null,      // 心跳定时器
    lastPongTime: 0,           // 上次收到pong的时间
    connectionStatus: 'offline', // 'offline'|'connecting'|'online'|'disconnected'
};

// ==================== 初始化 ====================

function startSingleGame(difficulty) {
    G.mode = 'single';
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
    G.quizTreatmentCorrect = null;
    G.isProcessing = false;
    G.role = null;
    // 隐藏联机状态指示器
    $('conn-status').style.display = 'none';

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

// ==================== 联机网络层 ====================

// 生成随机四位房间号
function generateRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function initHost(roomCode) {
    G.mode = 'online';
    G.role = 'host';
    G.connectionStatus = 'connecting';
    updateConnStatus();
    $('lobby-status').textContent = '正在创建房间...';
    $('lobby-status').style.color = '';


    G.peer = new Peer(roomCode);
    G.peer.on('open', function(id) {
        G.roomCode = id;
        G.connectionStatus = 'offline';
        updateConnStatus();
        $('input-host-room-code').style.display = 'none';
        $('btn-random-code').style.display = 'none';
        $('btn-create-room').style.display = 'none';
        $('room-code-display').style.display = '';
        $('room-code').textContent = id;
        $('btn-copy-code').disabled = false;
        $('lobby-status').textContent = '等待对手加入...';
    });
    G.peer.on('connection', function(conn) {
        onConnectionOpen(conn, 'host');
    });
    G.peer.on('error', function(err) {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
            $('lobby-status').textContent = '该房间号已被占用，换一个试试';
        } else {
            $('lobby-status').textContent = '创建房间失败：' + err.message;
        }
        $('lobby-status').style.color = 'var(--red)';
        G.connectionStatus = 'offline';
        updateConnStatus();
        $('btn-create-room').disabled = false;
    });
    G.peer.on('disconnected', function() {
        if (G.connectionStatus === 'online') onDisconnect();
    });
}

function initGuest(roomCode) {
    G.mode = 'online';
    G.role = 'guest';
    G.roomCode = roomCode;
    G.connectionStatus = 'connecting';
    updateConnStatus();
    $('lobby-status').textContent = '正在连接房间...';

    G.peer = new Peer();
    G.peer.on('open', function(id) {
        var conn = G.peer.connect(roomCode, { reliable: true });
        conn.on('open', function() { onConnectionOpen(conn, 'guest'); });
        conn.on('error', function(err) {
            console.error('Connection error:', err);
            $('lobby-status').textContent = '连接失败，请检查房间码是否正确';
            $('lobby-status').style.color = 'var(--red)';
            G.connectionStatus = 'offline';
            updateConnStatus();
        });
    });
    G.peer.on('error', function(err) {
        console.error('PeerJS error:', err);
        if (err.type === 'peer-unavailable') {
            $('lobby-status').textContent = '房间不存在或已过期';
        } else {
            $('lobby-status').textContent = '连接失败：' + err.message;
        }
        $('lobby-status').style.color = 'var(--red)';
        G.connectionStatus = 'offline';
        updateConnStatus();
    });
}

function onConnectionOpen(conn, myRole) {
    G.conn = conn;
    G.role = myRole;
    G.connectionStatus = 'online';
    G.lastPongTime = Date.now();
    updateConnStatus();

    conn.on('data', function(data) { onPeerMessage(data); });
    conn.on('close', function() { onDisconnect(); });
    conn.on('error', function() { onDisconnect(); });

    startHeartbeat();

    if (myRole === 'host') {
        $('lobby-status').textContent = '对手已连接！正在开始游戏...';
        $('lobby-status').style.color = 'var(--green)';
        setTimeout(function() { startOnlineGame(); }, 800);
    } else {
        $('lobby-status').textContent = '已连接！等待房主开始游戏...';
        $('lobby-status').style.color = 'var(--green)';
    }
}

function startOnlineGame() {
    G.deck = shuffle(createDeck());
    G.playerHand = [];
    G.computerHand = [];
    G.phase = 'player_attack';
    G.attacker = 'host';
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.quizTreatmentCorrect = null;
    G.isProcessing = false;
    G.opponentHandCount = 5;
    G._deckCount = G.deck.length;

    for (var i = 0; i < 5; i++) {
        G.playerHand.push(G.deck.pop());
        G.computerHand.push(G.deck.pop());
    }

    closeModal('lobby-modal');
    updateOpponentLabel();

    var guestHand = G.computerHand.map(function(c) { return Object.assign({}, c); });
    G.conn.send({
        type: 'init',
        yourHand: guestHand,
        deckCount: G.deck.length,
    });

    $('battle-log').innerHTML = '';
    $('difficulty-badge').textContent = '联机';
    $('difficulty-badge').className = 'badge online';
    $('conn-status').style.display = '';

    renderAll();
    addLog('联机对战开始！你是先手。', 'log-action');
    addLog('房间码：' + G.roomCode, 'log-info');

    phaseOnlineAttack();
}

function handleInit(data) {
    G.playerHand = data.yourHand;
    G.computerHand = [];
    G.opponentHandCount = 5;
    G._deckCount = data.deckCount;
    G.phase = 'opponent_turn';
    G.attacker = 'host';
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.quizTreatmentCorrect = null;
    G.isProcessing = false;

    closeModal('lobby-modal');
    updateOpponentLabel();

    $('battle-log').innerHTML = '';
    $('difficulty-badge').textContent = '联机';
    $('difficulty-badge').className = 'badge online';
    $('conn-status').style.display = '';

    renderAll();
    addLog('联机对战开始！对手先手。', 'log-action');
    addLog('房间码：' + G.roomCode, 'log-info');
    phaseOnlineWaiting();
}

function startHeartbeat() {
    stopHeartbeat();
    G.heartbeatTimer = setInterval(function() {
        if (G.conn && G.conn.open) {
            sendToOpponent({ type: 'ping' });
        }
        if (Date.now() - G.lastPongTime > 30000 && G.connectionStatus === 'online') {
            onDisconnect();
        }
    }, 5000);
}

function stopHeartbeat() {
    if (G.heartbeatTimer) {
        clearInterval(G.heartbeatTimer);
        G.heartbeatTimer = null;
    }
}

function sendToOpponent(msg) {
    if (G.conn && G.conn.open) {
        G.conn.send(msg);
    }
}

function onDisconnect() {
    if (G.connectionStatus === 'disconnected') return;
    G.connectionStatus = 'disconnected';
    updateConnStatus();
    stopHeartbeat();
    if (G.phase !== 'init' && G.phase !== 'game_over' && G.mode === 'online') {
        addLog('对手已断开连接！', 'log-error');
        setTimeout(function() {
            if (G.phase !== 'game_over') endGame('player', 'disconnect');
        }, 1500);
    }
}

function cleanupPeer() {
    stopHeartbeat();
    if (G.conn) { G.conn.close(); G.conn = null; }
    if (G.peer) { G.peer.destroy(); G.peer = null; }
    G.connectionStatus = 'offline';
    G.mode = 'single';
    G.role = null;
    $('conn-status').style.display = 'none';
}

function updateConnStatus() {
    var dot = $('conn-status');
    dot.className = 'conn-status ' + G.connectionStatus;
    var labels = {
        online: '已连接',
        connecting: '连接中',
        disconnected: '已断开',
        offline: '等待中'
    };
    dot.textContent = labels[G.connectionStatus] || '';
}

function updateOpponentLabel() {
    var el = document.querySelector('#computer-area .player-name');
    if (el) el.textContent = '对手';
    var label2 = document.querySelector('#computer-area .player-avatar');
    if (label2) label2.textContent = '👤';
}

// ==================== 联机消息处理 ====================

function onPeerMessage(data) {
    G.lastPongTime = Date.now();
    switch (data.type) {
        case 'init':       handleInit(data); break;
        case 'attack':     handleOpponentAttack(data); break;
        case 'defense':    handleOpponentDefense(data); break;
        case 'draw':       handleGuestDrawRequest(data); break;
        case 'draw_result': handleDrawResult(data); break;
        case 'host_drew':  handleHostDrew(data); break;
        case 'game_over':  handleGameOverMsg(data); break;
        case 'pong':       G.lastPongTime = Date.now(); break;
    }
}

function handleOpponentAttack(data) {
    G.activeDisease = data.card;
    G.battleAttack = [data.card];
    G.battleDefend = [];
    G.opponentHandCount = data.handCount;
    if (G.role === 'host') {
        G._deckCount = G.deck.length;
        // 从对手手牌中移除已打出的疾病卡
        var idx = G.computerHand.findIndex(function(c) { return c.id === data.card.id; });
        if (idx >= 0) G.computerHand.splice(idx, 1);
    } else {
        G._deckCount = data.deckCount;
    }
    G.playerSelected = [];
    addLog(data.log || '对手打出了疾病卡！请应对。', 'log-action');
    renderAll();
    phaseOnlineDefend();
}

function handleOpponentDefense(data) {
    G.battleDefend = data.cards;
    G.opponentHandCount = data.handCount;
    if (G.role === 'host') {
        G._deckCount = G.deck.length;
        // 从对手手牌中移除已打出的治疗卡
        if (data.cardIds) {
            data.cardIds.forEach(function(id) {
                var idx = G.computerHand.findIndex(function(c) { return c.id === id; });
                if (idx >= 0) G.computerHand.splice(idx, 1);
            });
        }
    }
    addLog(data.log || '对手已完成应对。', data.quizPassed ? 'log-info' : 'log-warn');
    renderAll();

    if (data.handCount === 0) {
        endGame('opponent', 'empty_hand');
        return;
    }

    if (data.quizPassed) {
        phaseOnlineWaiting();
    } else {
        phaseOnlineAttack();
    }
}

function handleGuestDrawRequest(data) {
    var needType = data.needType;
    var targetLevel = data.targetLevel || 0;
    var drawnCards = [];
    var hand = G.computerHand;

    while (true) {
        var conditionMet = false;
        if (needType === 'disease') conditionMet = hasDiseaseCard(hand);
        else conditionMet = canMatchLevel(hand, targetLevel);
        if (conditionMet) break;

        if (G.deck.length === 0) {
            G.conn.send({ type: 'game_over', winner: 'host', reason: 'deck_empty' });
            endGame('player', 'deck_empty');
            return;
        }

        var card = G.deck.pop();
        hand.push(card);
        drawnCards.push(card);
    }

    G.opponentHandCount = hand.length;
    G._deckCount = G.deck.length;
    renderDeckCount();

    G.conn.send({
        type: 'draw_result',
        cards: drawnCards,
        deckCount: G.deck.length,
    });
}

function handleDrawResult(data) {
    for (var i = 0; i < data.cards.length; i++) {
        G.playerHand.push(data.cards[i]);
    }
    G._deckCount = data.deckCount;
    renderAll();
    if (G._pendingDrawResolve) {
        G._pendingDrawResolve(true);
        G._pendingDrawResolve = null;
    }
}

function handleHostDrew(data) {
    G._deckCount = data.deckCount;
    G.opponentHandCount = data.handCount;
    renderDeckCount();
    renderCardCounts();
}

function handleGameOverMsg(data) {
    endGame(data.winner === G.role ? 'player' : 'computer', data.reason);
}

// ==================== 联机阶段函数 ====================

async function phaseOnlineAttack() {
    if (G.phase === 'game_over') return;
    G.phase = 'player_attack';
    G.attacker = G.role;
    G.activeDisease = null;
    G.playerSelected = [];
    G.battleAttack = [];
    G.battleDefend = [];
    renderAll();

    if (!hasDiseaseCard(G.playerHand)) {
        addLog('你没有疾病卡，正在抽牌...', 'log-warn');
        var ok = await onlineDrawLoop('player', 'disease', 0);
        if (!ok) return;
    }

    $('turn-indicator').innerHTML = '⚔️ <b>你的回合 — 请选择一张疾病卡攻击</b>';
    addLog('请从手牌中选择一张<b>疾病卡</b>打出。', 'log-action');
    enablePlayerSelect('disease');
}

async function phaseOnlineDefend() {
    if (G.phase === 'game_over') return;
    G.phase = 'player_defend';
    G.playerSelected = [];
    G.battleDefend = [];
    renderAll();

    var targetLevel = G.activeDisease.level;

    if (!canMatchLevel(G.playerHand, targetLevel)) {
        addLog('你的手牌无法应对，正在抽牌...', 'log-warn');
        var ok = await onlineDrawLoop('player', 'defense', targetLevel);
        if (!ok) return;
    }

    $('turn-indicator').innerHTML = '🛡️ 请选择治疗卡应对 <b>' + G.activeDisease.name + '</b>（需 ≥' + targetLevel + '级）';
    addLog('请选择治疗卡/时间卡/疫苗，总等级需 ≥ ' + targetLevel + '。', 'log-action');
    enablePlayerSelect('defense');
}

async function phaseOnlineWaiting() {
    G.phase = 'opponent_turn';
    disablePlayerSelect();
    $('turn-indicator').textContent = '⏳ 等待对手操作...';
    renderAll();
}

async function onlineDrawLoop(who, needType, targetLevel) {
    G.isProcessing = true;
    var hand = G.playerHand;
    var name = '你';

    if (G.role === 'host') {
        var totalDrew = 0;
        while (true) {
            var conditionMet = false;
            if (needType === 'disease') conditionMet = hasDiseaseCard(hand);
            else conditionMet = canMatchLevel(hand, targetLevel);

            if (conditionMet) {
                if (totalDrew > 0) addLog(name + '抽到了需要的卡牌。', 'log-info');
                break;
            }

            if (G.deck.length === 0) {
                addLog('牌堆已空，' + name + '无法出牌！', 'log-error');
                await sleep(600);
                endGame('opponent', 'deck_empty');
                G.isProcessing = false;
                return false;
            }

            hand.push(G.deck.pop());
            totalDrew++;
            addLog(name + '抽到了一张牌。', 'log-info');
            G._deckCount = G.deck.length;
            renderAll();
            await sleep(500);
        }
        if (totalDrew > 0) {
            sendToOpponent({ type: 'host_drew', deckCount: G.deck.length, handCount: G.playerHand.length });
        }
    } else {
        sendToOpponent({ type: 'draw', needType: needType, targetLevel: targetLevel });
        addLog('正在等待抽牌...', 'log-info');
        var ok = await new Promise(function(resolve) { G._pendingDrawResolve = resolve; });
        if (!ok) { G.isProcessing = false; return false; }
    }

    renderAll();
    G.isProcessing = false;
    return true;
}

// ==================== 联机确认操作 ====================

async function onlineConfirmAttack() {
    G.isProcessing = true;
    var card = G.playerSelected[0];
    var idx = G.playerHand.findIndex(function(c) { return c.id === card.id; });
    G.playerHand.splice(idx, 1);
    G.activeDisease = card;
    G.battleAttack = [card];
    G.playerSelected = [];
    disablePlayerSelect();

    addLog('你打出疾病卡「<b>' + card.name + '</b>」（等级 ' + card.level + '）', 'log-action');
    $('turn-indicator').textContent = '你打出 ' + card.name + '（等级 ' + card.level + '）';
    renderAll();
    await sleep(600);

    if (checkWinAfterPlay('player')) { G.isProcessing = false; return; }

    sendToOpponent({
        type: 'attack',
        card: { id: card.id, name: card.name, type: card.type, level: card.level, image: card.image },
        deckCount: G.role === 'host' ? G.deck.length : G._deckCount,
        handCount: G.playerHand.length,
        log: '对手打出疾病卡「<b>' + card.name + '</b>」（等级 ' + card.level + '），请应对！',
    });

    G.isProcessing = false;
    await phaseOnlineWaiting();
}

async function onlineConfirmDefend() {
    var targetLevel = G.activeDisease.level;
    var effLevel = calcEffectiveLevel(G.playerSelected);

    if (effLevel < targetLevel) {
        addLog('总等级 ' + effLevel + ' 不足 ' + targetLevel + '，请选择更多卡牌。', 'log-warn');
        return;
    }

    G.isProcessing = true;
    G.battleDefend = [].concat(G.playerSelected);

    G.playerSelected.forEach(function(c) {
        var idx = G.playerHand.findIndex(function(h) { return h.id === c.id; });
        if (idx >= 0) G.playerHand.splice(idx, 1);
    });
    G.playerSelected = [];
    disablePlayerSelect();

    var hasVaccine = G.battleDefend.some(function(c) { return c.type === 'special'; });
    var vaccineNote = hasVaccine ? '（疫苗翻倍！）' : '';
    addLog('你打出 ' + G.battleDefend.map(function(c) { return c.name; }).join(' + ') + '，有效等级 ' + effLevel + ' ' + vaccineNote, 'log-action');
    $('turn-indicator').textContent = '你的应对等级: ' + effLevel + ' ≥ ' + targetLevel + ' ✓';
    renderAll();
    await sleep(600);

    if (checkWinAfterPlay('player')) { G.isProcessing = false; return; }

    G.quizDisease = G.activeDisease.name;
    G.isProcessing = false;
    await phasePlayerQuiz();
}

// ==================== 联机问答结果处理 ====================

async function onlineOnQuizPass() {
    G.phase = 'player_attack';
    G.attacker = G.role;
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.quizTreatmentCorrect = null;
    G.battleAttack = [];
    G.battleDefend = [];
    G.activeDisease = null;
    G.playerSelected = [];
    G.isProcessing = false;
    renderAll();
    await sleep(400);
    await phaseOnlineAttack();
}

async function onlineOnQuizFail() {
    G.phase = 'opponent_turn';
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.quizTreatmentCorrect = null;
    G.battleAttack = [];
    G.battleDefend = [];
    G.activeDisease = null;
    G.playerSelected = [];
    G.isProcessing = false;
    renderAll();
    await sleep(400);
    await phaseOnlineWaiting();
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

    // 电脑回答知识问答（按难度有概率答错）
    const diseaseName = G.activeDisease.name;
    const kb = DISEASE_KNOWLEDGE[diseaseName];
    const errorRate = DIFFICULTY[G.difficulty].quizErrorRate || 0;

    if (kb && errorRate > 0) {
        // 治疗判定
        const treatWrong = Math.random() < errorRate;
        let compTreatText;
        if (treatWrong) {
            const wrongs = kb.treatment.options.filter(o => !o.correct);
            compTreatText = wrongs[Math.floor(Math.random() * wrongs.length)].text;
        } else {
            compTreatText = kb.treatment.options.find(o => o.correct).text;
        }
        // 症状判定
        const sympWrong = Math.random() < errorRate;
        let compSympTexts;
        if (sympWrong) {
            const corrects = kb.symptoms.options.filter(o => o.correct);
            const wrongs = kb.symptoms.options.filter(o => !o.correct);
            // 1对 + 1错
            compSympTexts = [
                corrects[Math.floor(Math.random() * corrects.length)].text,
                wrongs[Math.floor(Math.random() * wrongs.length)].text,
            ];
        } else {
            compSympTexts = kb.symptoms.options.filter(o => o.correct).map(o => o.text);
        }

        const compAllCorrect = !treatWrong && !sympWrong;
        const icon = compAllCorrect ? '✓' : '✗';
        const cls = compAllCorrect ? 'log-info' : 'log-warn';
        addLog(`电脑回答：治疗「${compTreatText}」，症状「${compSympTexts.join('」和「')}」${icon}`, cls);

        if (!compAllCorrect) {
            addLog('电脑答错了！轮到你继续攻击。', 'log-action');
            renderAll();
            await sleep(1200);
            if (checkWinAfterPlay('computer')) return;
            await phasePlayerAttack();
            return;
        }
    } else {
        // 困难难度或没有知识库：电脑全对
        const correctTreatment = kb ? kb.treatment.options.find(o => o.correct).text : '—';
        const correctSymptoms = kb ? kb.symptoms.options.filter(o => o.correct).map(o => o.text) : ['—'];
        addLog(`电脑回答：治疗「${correctTreatment}」，症状「${correctSymptoms.join('」和「')}」✓`, 'log-info');
    }

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
            // 当前已选等级已足够则不允许再添加（防止故意浪费卡牌）
            const curEff = calcEffectiveLevel(G.playerSelected);
            const target = G.activeDisease ? G.activeDisease.level : 0;
            if (curEff >= target) {
                addLog('当前等级已足够应对，不需要再选更多卡牌。', 'log-warn');
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
        if (G.mode === 'online') {
            onlineConfirmAttack();
        } else {
            confirmPlayerAttack();
        }
    } else if (G.phase === 'player_defend') {
        if (G.mode === 'online') {
            onlineConfirmDefend();
        } else {
            confirmPlayerDefend();
        }
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
    G.quizTreatmentCorrect = null;

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

    // 步骤1：显示治疗方法，隐藏症状；恢复按钮可见性（上次问答可能被 highlightQuizAnswers 隐藏）
    $('quiz-step1').style.display = '';
    $('quiz-step2').style.display = 'none';
    $('quiz-step1-btn').style.display = '';
    $('quiz-step1-btn').disabled = true;
    $('quiz-step2-btn').style.display = '';
    $('quiz-hint1').textContent = '请选择1个治疗方法';
    $('quiz-hint1').style.color = '';
    // 恢复治疗选项可点击（上次可能被 goToQuizStep2 禁用了）
    Array.from($('quiz-treatment-options').children).forEach(el => {
        el.style.pointerEvents = '';
        el.classList.remove('correct', 'wrong', 'selected');
    });
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

// 步骤1→步骤2：先即时反馈治疗方法对错，再进入症状选择
async function goToQuizStep2() {
    if (G.quizTreatment === null) return;
    if (G.isProcessing) return;
    G.isProcessing = true;

    const kb = DISEASE_KNOWLEDGE[G.quizDisease];
    const isCorrect = kb.treatment.options[G.quizTreatment].correct;
    G.quizTreatmentCorrect = isCorrect;

    // 禁用按钮防止重复点击
    $('quiz-step1-btn').disabled = true;

    // 高亮正确答案 + 玩家选择
    Array.from($('quiz-treatment-options').children).forEach((el, i) => {
        el.style.pointerEvents = 'none';  // 禁止再点
        if (kb.treatment.options[i].correct) el.classList.add('correct');
        else if (i === G.quizTreatment && !isCorrect) el.classList.add('wrong');
    });

    if (isCorrect) {
        $('quiz-hint1').textContent = '✅ 治疗方法正确！';
        $('quiz-hint1').style.color = 'var(--green)';
    } else {
        $('quiz-hint1').textContent = '❌ 治疗方法选错了';
        $('quiz-hint1').style.color = 'var(--red)';
    }

    await sleep(1200);

    // 切换到步骤2
    G.quizStep = 2;
    $('quiz-step1').style.display = 'none';
    $('quiz-step2').style.display = '';
    $('quiz-step2-btn').disabled = true;
    $('quiz-hint2').textContent = '请选择2个症状';
    updateQuizStepIndicator(2);
    G.isProcessing = false;
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

    const treatmentCorrect = G.quizTreatmentCorrect === true;
    const symptomsCorrect = G.quizSymptoms.every(i => kb.symptoms.options[i].correct)
        && G.quizSymptoms.length === 2
        && kb.symptoms.options.filter((o, i) => o.correct && G.quizSymptoms.includes(i)).length === 2;

    // 显示症状结果 + 禁用点击
    highlightQuizAnswers(kb);

    // 联机模式：发送防御结果给对手
    if (G.mode === 'online') {
        sendToOpponent({
            type: 'defense',
            cards: G.battleDefend.map(function(c) { return { name: c.name, type: c.type, level: c.level, image: c.image }; }),
            cardIds: G.battleDefend.map(function(c) { return c.id; }),
            effLevel: calcEffectiveLevel(G.battleDefend),
            handCount: G.playerHand.length,
            quizPassed: treatmentCorrect && symptomsCorrect,
            log: (treatmentCorrect && symptomsCorrect) ? '对手防御成功，问答通过！' : '对手防御成功，但问答失败，继续进攻！',
        });
    }

    if (treatmentCorrect && symptomsCorrect) {
        addLog('✅ 回答完全正确！轮到你出牌攻击。', 'log-action');
        await sleep(1200);
        closeModal('quiz-modal');
        if (G.mode === 'online') {
            onlineOnQuizPass();
        } else {
            onQuizPass();
        }
    } else {
        let reason = '';
        if (!treatmentCorrect) reason += '治疗方法选错';
        if (!symptomsCorrect) reason += (reason ? '，' : '') + '症状选错';
        addLog(`❌ 回答错误（${reason}），对手继续攻击！`, 'log-error');
        await sleep(1800);
        closeModal('quiz-modal');
        if (G.mode === 'online') {
            onlineOnQuizFail();
        } else {
            onQuizFail();
        }
    }
}

function highlightQuizAnswers(kb) {
    // 高亮症状选项 + 禁用点击
    Array.from($('quiz-symptom-options').children).forEach((el, i) => {
        el.style.pointerEvents = 'none';
        if (kb.symptoms.options[i].correct) el.classList.add('correct');
        else if (G.quizSymptoms.includes(i) && !kb.symptoms.options[i].correct) el.classList.add('wrong');
    });
    $('quiz-step2-btn').style.display = 'none';

    // 汇总提示
    const tOk = G.quizTreatmentCorrect === true;
    const sOk = G.quizSymptoms.every(i => kb.symptoms.options[i].correct)
        && G.quizSymptoms.length === 2
        && kb.symptoms.options.filter((o, i) => o.correct && G.quizSymptoms.includes(i)).length === 2;
    if (tOk && sOk) {
        $('quiz-hint2').textContent = '✅ 全部正确！';
        $('quiz-hint2').style.color = 'var(--green)';
    } else {
        $('quiz-hint2').textContent = '❌ 有错误，请看上方标注';
        $('quiz-hint2').style.color = 'var(--red)';
    }
}

async function onQuizPass() {
    G.phase = 'player_attack';
    G.attacker = 'player';
    G.quizDisease = null;
    G.quizTreatment = null;
    G.quizSymptoms = [];
    G.quizStep = 1;
    G.quizTreatmentCorrect = null;
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
    G.quizTreatmentCorrect = null;
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
        // 联机host模式：通知对手抽牌（裁剪对手的牌堆副本）
        if (G.mode === 'online' && G.role === 'host' && who === 'player') {
            sendToOpponent({ type: 'host_drew', deckCount: G.deck.length, handCount: G.playerHand.length });
        }
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
    var hand;
    if (G.mode === 'online') {
        hand = G.playerHand;
        if (hand.length === 0) {
            sendToOpponent({ type: 'game_over', winner: G.role, reason: 'empty_hand' });
            endGame('player', 'empty_hand');
            return true;
        }
        return false;
    }
    hand = who === 'player' ? G.playerHand : G.computerHand;
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
    cleanupPeer();
    renderAll();

    var isPlayerWin = winner === 'player';
    var loserLabel = G.mode === 'online' ? '对手' : '电脑';

    $('gameover-icon').textContent = isPlayerWin ? '🎉' : '😞';
    $('gameover-title').textContent = isPlayerWin ? '恭喜，你赢了！' : '很遗憾，你输了。';
    $('gameover-title').style.color = isPlayerWin ? 'var(--green)' : 'var(--red)';

    var detail = '';
    if (reason === 'empty_hand') {
        detail = isPlayerWin ? '你打出了所有手牌！' : loserLabel + '打出了所有手牌。';
    } else if (reason === 'disconnect') {
        detail = '对手断开连接，你获胜了！';
        isPlayerWin = true;
    } else if (reason === 'deck_empty') {
        detail = '牌堆耗尽，无法继续出牌。';
    } else if (reason === 'disconnect') {
        detail = '对手断开连接，你赢了！';
        isPlayerWin = true;
        $('gameover-title').textContent = '对手断开了连接';
        $('gameover-title').style.color = 'var(--gold)';
        $('gameover-icon').textContent = '🔌';
        addLog('对手断开连接，你获胜！', 'log-action');
    }
    $('gameover-detail').textContent = detail;
    openModal('gameover-modal');

    $('turn-indicator').textContent = isPlayerWin ? '🏆 你赢了！' : '💀 你输了...';
    if (reason !== 'disconnect') {
        addLog(isPlayerWin ? '🎉 恭喜获胜！' : '💀 败北...再来一局吧！', isPlayerWin ? 'log-action' : 'log-error');
    }
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
        // 对手手牌显示背面（单人=电脑，联机=对手）
        var oppHand = hand;
        if (G.mode === 'online' && G.role === 'guest') {
            // Guest only knows opponent hand count
            oppHand = Array(G.opponentHandCount).fill(null);
        }
        oppHand.forEach((card, i) => {
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
    var count = (G.mode === 'online' && G.role === 'guest') ? G._deckCount : G.deck.length;
    $('deck-count').textContent = `剩余: ${count}`;
}

function renderCardCounts() {
    $('player-card-count').textContent = `手牌: ${G.playerHand.length}`;
    if (G.mode === 'online') {
        var oppCount = G.role === 'host' ? G.computerHand.length : G.opponentHandCount;
        $('computer-card-count').textContent = `手牌: ${oppCount}`;
    } else {
        $('computer-card-count').textContent = `手牌: ${G.computerHand.length}`;
    }
}

function enablePlayerSelect(mode) {
    // mode: 'disease' | 'defense'
    $('btn-confirm').style.display = 'inline-block';
    const btn = $('btn-confirm');
    if (mode === 'defense') {
        btn.textContent = '请选择治疗卡应对';
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
            btn.textContent = '请选择治疗卡应对';
        } else {
            const eff = calcEffectiveLevel(G.playerSelected);
            const target = G.activeDisease ? G.activeDisease.level : 0;
            btn.disabled = eff < target;
            btn.textContent = eff >= target
                ? `确认出牌 (${G.playerSelected.length}张, 等级 ${eff} ≥ ${target})`
                : `等级不足 (${G.playerSelected.length}张, ${eff} < ${target})`;
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
    // ===== 模式选择 =====
    $('btn-single').addEventListener('click', () => {
        closeModal('mode-modal');
        openModal('difficulty-modal');
    });
    $('btn-online').addEventListener('click', () => {
        closeModal('mode-modal');
        openModal('lobby-modal');
        // Reset lobby UI
        $('input-host-room-code').style.display = '';
        $('input-host-room-code').value = '';
        $('btn-random-code').style.display = '';
        $('btn-create-room').style.display = '';
        $('btn-create-room').disabled = false;
        $('room-code-display').style.display = 'none';
        $('btn-copy-code').disabled = true;
        $('input-room-code').value = '';
        $('lobby-status').textContent = '请创建或加入房间';
        $('lobby-status').style.color = '';
    });

    // ===== 联机大厅 =====
    $('btn-random-code').addEventListener('click', () => {
        $('input-host-room-code').value = generateRoomCode();
    });
    $('btn-create-room').addEventListener('click', () => {
        var code = $('input-host-room-code').value.trim();
        // 验证：只能是4位数字，空则随机生成
        if (code && !/^\d{4}$/.test(code)) {
            $('lobby-status').textContent = '房间号必须为4位数字';
            $('lobby-status').style.color = 'var(--red)';
            return;
        }
        if (!code) {
            code = generateRoomCode();
            $('input-host-room-code').value = code;
        }
        $('btn-create-room').disabled = true;
        initHost(code);
    });
    $('btn-join-room').addEventListener('click', () => {
        var code = $('input-room-code').value.trim();
        if (!code) return;
        $('btn-join-room').disabled = true;
        $('input-room-code').disabled = true;
        initGuest(code);
    });
    $('input-room-code').addEventListener('input', () => {
        $('btn-join-room').disabled = !$('input-room-code').value.trim();
    });
    $('btn-copy-code').addEventListener('click', () => {
        var code = G.roomCode;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(() => {
                $('btn-copy-code').textContent = '已复制!';
                setTimeout(() => { $('btn-copy-code').textContent = '复制'; }, 2000);
            });
        } else {
            // Fallback for WeChat
            var ta = document.createElement('textarea');
            ta.value = code;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            $('btn-copy-code').textContent = '已复制!';
            setTimeout(() => { $('btn-copy-code').textContent = '复制'; }, 2000);
        }
    });
    $('btn-back-mode').addEventListener('click', () => {
        cleanupPeer();
        closeModal('lobby-modal');
        openModal('mode-modal');
    });

    // ===== 单人难度选择 =====
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const diff = btn.dataset.diff;
            startSingleGame(diff);
        });
    });

    // 确认出牌
    $('btn-confirm').addEventListener('click', onPlayerConfirm);

    // 问答步骤按钮
    $('quiz-step1-btn').addEventListener('click', goToQuizStep2);
    $('quiz-step2-btn').addEventListener('click', onQuizSubmit);

    // 重新开始
    $('gameover-restart').addEventListener('click', () => {
        cleanupPeer();
        closeModal('gameover-modal');
        openModal('mode-modal');
    });
    $('btn-restart').addEventListener('click', () => {
        if (G.phase !== 'game_over' && G.phase !== 'init') {
            var msg = G.mode === 'online'
                ? '确定要退出当前对战吗？'
                : '确定要重新开始吗？当前进度将丢失。';
            if (!confirm(msg)) return;
        }
        cleanupPeer();
        closeModal('gameover-modal');
        openModal('mode-modal');
        G.phase = 'init';
        disablePlayerSelect();
        $('battle-log').innerHTML = '<p class="log-placeholder">请选择模式开始游戏。</p>';
        $('turn-indicator').textContent = '等待开始...';
        G.battleAttack = [];
        G.battleDefend = [];
        G.mode = 'single';
        G.role = null;
        renderAll();
    });

    // 初始显示模式选择
    openModal('mode-modal');
    $('btn-confirm').style.display = 'none';
    renderAll();
});
