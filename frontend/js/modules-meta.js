// 所有模組共用一個敘事主軸：玩家是被派駐到同一座邊緣運算節點的維運／資安人員，
// 每個模組對應這座節點的不同任務面向，因此 desc 一律以「這座節點」為主語。
const MODULES = [
  {
    id: 'story',
    icon: '📖',
    name: 'Story Mode',
    desc: '取得這座邊緣節點的存取權限（15 關）',
    status: 'available',
    href: 'story.html',
  },
  {
    id: 'sandbox',
    icon: '🧪',
    name: 'Sandbox',
    desc: '在這座節點上自由架設與實驗',
    status: 'coming-soon',
    phase: 1,
  },
  {
    id: 'forensics',
    icon: '🕵️',
    name: 'Forensics Lab',
    desc: '調查這座節點過去發生的資安事故',
    status: 'coming-soon',
    phase: 2,
  },
  {
    id: 'network',
    icon: '🌐',
    name: 'Network Lab',
    desc: '分析這座節點所在網路的威脅活動',
    status: 'coming-soon',
    phase: 2,
  },
  {
    id: 'ops',
    icon: '📡',
    name: 'Ops Center',
    desc: '即時監控這座節點的運作狀態',
    status: 'coming-soon',
    phase: 1,
  },
  {
    id: 'maker',
    icon: '🧩',
    name: 'Maker Mode',
    desc: '為下一批駐點人員設計挑戰',
    status: 'coming-soon',
    phase: 4,
  },
];

function getModule(id) {
  return MODULES.find(m => m.id === id) || null;
}
