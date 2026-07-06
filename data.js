// ============================================================
// 瘟疫危机 卡牌游戏 - 数据层
// ============================================================

// --- 卡牌定义 ---
// 每张卡牌: id, name, type, level, image, description
// type: 'disease' | 'treatment' | 'time' | 'special'

const CARD_DEFS = [
    // 疾病类 (12张)
    { name: '新冠病毒', type: 'disease', level: 10, count: 1, image: 'cards/COVID-19.webp',
      desc: 'COVID-19，传染性极强' },
    { name: '肺炎',     type: 'disease', level: 8,  count: 2, image: 'cards/Pneumonia.webp',
      desc: '细菌性肺炎，需要抗生素治疗' },
    { name: '甲流',     type: 'disease', level: 7,  count: 3, image: 'cards/H1N1.webp',
      desc: '甲型H1N1流感，抗病毒治疗有效' },
    { name: '感冒',     type: 'disease', level: 6,  count: 6, image: 'cards/cold.webp',
      desc: '普通感冒，对症治疗即可' },

    // 治疗类 (12张)
    { name: '科学家',   type: 'treatment', level: 7, count: 1, image: 'cards/scientist.webp',
      desc: '研发治疗方案的核心力量' },
    { name: '医生',     type: 'treatment', level: 7, count: 1, image: 'cards/doctor.webp',
      desc: '临床经验丰富的主治医师' },
    { name: '药剂师',   type: 'treatment', level: 6, count: 2, image: 'cards/Pharmacist.webp',
      desc: '调配药物，精准用药' },
    { name: '护士',     type: 'treatment', level: 5, count: 2, image: 'cards/nurse.webp',
      desc: '细心护理，加速康复' },
    { name: '志愿者',   type: 'treatment', level: 4, count: 6, image: 'cards/volunteer.webp',
      desc: '基层防疫的中坚力量' },

    // 时间类 (9张)
    { name: '十天',     type: 'time', level: 3, count: 3, image: 'cards/tendays.webp',
      desc: '争取十天的治疗窗口' },
    { name: '五天',     type: 'time', level: 2, count: 6, image: 'cards/fivedays.webp',
      desc: '争取五天的治疗窗口' },

    // 特殊卡 (1张)
    { name: '疫苗',     type: 'special', level: 0, count: 1, image: 'cards/vaccine.webp',
      desc: '治疗等级翻倍！与治疗卡组合使用' },
];

// 生成完整牌堆 (34张)
function createDeck() {
    const deck = [];
    let id = 0;
    CARD_DEFS.forEach(def => {
        for (let i = 0; i < def.count; i++) {
            deck.push({
                id: id++,
                name: def.name,
                type: def.type,
                level: def.level,
                image: def.image,
                desc: def.desc,
            });
        }
    });
    return deck;
}

// --- 疾病知识库 (选择题) ---
// 每种疾病: treatmentQuestion + symptomQuestion
const DISEASE_KNOWLEDGE = {
    '新冠病毒': {
        treatment: {
            question: '新冠病毒的主要治疗方法是什么？',
            options: [
                { text: '抗病毒治疗（如瑞德西韦、帕昔洛韦）', correct: true },
                { text: '大剂量抗生素冲击疗法', correct: false },
                { text: '外科手术切除病灶', correct: false },
                { text: '放射治疗', correct: false },
            ],
        },
        symptoms: {
            question: '新冠病毒感染的典型症状有哪些？（选2项）',
            options: [
                { text: '发热', correct: true },
                { text: '干咳', correct: true },
                { text: '皮疹', correct: false },
                { text: '关节红肿', correct: false },
                { text: '视力急剧下降', correct: false },
                { text: '皮肤大面积瘙痒', correct: false },
            ],
        },
    },
    '肺炎': {
        treatment: {
            question: '细菌性肺炎的主要治疗方法是什么？',
            options: [
                { text: '抗生素治疗', correct: true },
                { text: '抗病毒治疗', correct: false },
                { text: '化学治疗', correct: false },
                { text: '透析治疗', correct: false },
            ],
        },
        symptoms: {
            question: '肺炎的典型症状有哪些？（选2项）',
            options: [
                { text: '咳嗽咳痰', correct: true },
                { text: '胸痛', correct: true },
                { text: '腹泻', correct: false },
                { text: '大量脱发', correct: false },
                { text: '持续性耳鸣', correct: false },
                { text: '下肢浮肿', correct: false },
            ],
        },
    },
    '甲流': {
        treatment: {
            question: '甲型H1N1流感的主要治疗方法是什么？',
            options: [
                { text: '抗病毒药物（如奥司他韦）', correct: true },
                { text: '广谱抗生素', correct: false },
                { text: '胰岛素注射', correct: false },
                { text: '降压药物治疗', correct: false },
            ],
        },
        symptoms: {
            question: '甲流的典型症状有哪些？（选2项）',
            options: [
                { text: '高热（39°C以上）', correct: true },
                { text: '全身肌肉酸痛', correct: true },
                { text: '长期便秘', correct: false },
                { text: '慢性失眠', correct: false },
                { text: '皮肤出现红斑', correct: false },
                { text: '单侧视力下降', correct: false },
            ],
        },
    },
    '感冒': {
        treatment: {
            question: '普通感冒的主要治疗方法是什么？',
            options: [
                { text: '对症支持治疗，多休息多饮水', correct: true },
                { text: '紧急外科手术', correct: false },
                { text: '放射治疗', correct: false },
                { text: '基因靶向治疗', correct: false },
            ],
        },
        symptoms: {
            question: '普通感冒的典型症状有哪些？（选2项）',
            options: [
                { text: '流鼻涕、鼻塞', correct: true },
                { text: '打喷嚏', correct: true },
                { text: '骨折样疼痛', correct: false },
                { text: '皮肤黄疸', correct: false },
                { text: '全身水肿', correct: false },
                { text: '剧烈胸痛', correct: false },
            ],
        },
    },
};

// --- 电脑难度配置 ---
const DIFFICULTY = {
    easy: {
        name: '简单',
        desc: '电脑随机出牌，适合新手',
        // 攻击: 随机选疾病卡 (不选最高)
        attackRandom: true,
        // 防御: 允许使用多余卡牌 (不追求最少)
        optimalDefense: false,
        // 疫苗使用概率: 30%
        vaccineUseChance: 0.3,
        // 防御时允许超出的等级余量 (越大越浪费)
        levelMargin: 3,
        // 知识问答错误率 (治疗/症状各独立判定)
        quizErrorRate: 0.3,
    },
    normal: {
        name: '普通',
        desc: '电脑合理出牌，有一定策略',
        attackRandom: false,
        optimalDefense: true,
        vaccineUseChance: 0.7,
        levelMargin: 0,
        quizErrorRate: 0.1,
    },
    hard: {
        name: '困难',
        desc: '电脑最优出牌，极具挑战',
        attackRandom: false,
        optimalDefense: true,
        vaccineUseChance: 1.0,
        levelMargin: 0,
        quizErrorRate: 0,
    },
};

// Fisher-Yates 洗牌
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
