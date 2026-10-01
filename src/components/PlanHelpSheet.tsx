import styles from './PlanHelpSheet.module.less'

/**
 * 行程单「备用信息页」：紧急联系电话 + 中韩求助用语对照。
 *
 * 用途：打印 / 存为图片时可选附上的一页。无网络或语言不通时，
 * 把「韩文」一栏直接指给身边的韩国人看，即可完成求助 / 问路 / 报失等沟通。
 *
 * 号码来源：中国驻济州总领馆 2026 年公告（jeju.china-consulate.gov.cn）。
 * 韩文短句为通用旅游用语；读音列为近似罗马音，仅供自己开口参考，指给韩国人看的是韩文列。
 */

interface PhoneRow {
  name: string
  num: string
  note: string
}

/** 韩国常用应急 / 咨询电话（已用官方来源核实） */
const PHONES: PhoneRow[] = [
  { name: '报警 / 警察', num: '112', note: '提供中文服务' },
  { name: '火灾 / 事故 / 救援', num: '119', note: '同时管急救与救护车' },
  { name: '外国人应急医疗', num: '1339', note: '救护车（英 / 汉可用）' },
  { name: '旅游服务咨询', num: '1330', note: '24h 多语种（含中文）' },
  { name: '海上救援', num: '122', note: '水上 / 船只遇险' },
  { name: '电话翻译（中文）', num: '120 转 9', note: '中韩电话翻译' },
  { name: '出入境咨询', num: '1345', note: '济州 064-741-5400' },
  { name: '消费投诉', num: '02-3460-3000', note: '' },
  { name: '中国驻济州总领馆 · 领保', num: '+82-64-722-8802', note: 'jeju@csm.mfa.gov.cn' },
  { name: '外交部全球领保热线', num: '+86-10-12308', note: '或 +86-10-65612308' },
]

interface PhraseRow {
  group: string
  cn: string
  ko: string
  rd: string
}

/** 中韩求助用语对照（韩文列可直接指给韩国人看） */
const PHRASES: PhraseRow[] = [
  // 沟通
  { group: '沟通', cn: '你好', ko: '안녕하세요', rd: 'an-nyeong-ha-se-yo' },
  { group: '沟通', cn: '谢谢', ko: '감사합니다', rd: 'gam-sa-hap-ni-da' },
  { group: '沟通', cn: '对不起 / 打扰了', ko: '실례합니다', rd: 'shil-lye-hap-ni-da' },
  { group: '沟通', cn: '请帮帮我', ko: '도와주세요', rd: 'do-wa-ju-se-yo' },
  { group: '沟通', cn: '我不懂韩语', ko: '한국말을 못해요', rd: 'han-guk-ma-reul mot-hae-yo' },
  { group: '沟通', cn: '你会说中文吗？', ko: '중국말 할 수 있어요?', rd: 'jung-guk-mal hal-su-iss-eo-yo?' },
  { group: '沟通', cn: '请说慢一点', ko: '천천히 말해 주세요', rd: 'cheon-cheon-hi mal-hae-ju-se-yo' },
  // 紧急 / 安全
  { group: '紧急·安全', cn: '请叫警察', ko: '경찰을 불러주세요', rd: 'gyeong-cha-reul bul-leo-ju-se-yo' },
  { group: '紧急·安全', cn: '请叫救护车', ko: '구급차를 불러주세요', rd: 'gu-geup-cha-reul bul-leo-ju-se-yo' },
  { group: '紧急·安全', cn: '我受伤了', ko: '다쳤어요', rd: 'da-chyeoss-eo-yo' },
  { group: '紧急·安全', cn: '我不舒服 / 我病了', ko: '아파요', rd: 'a-pa-yo' },
  { group: '紧急·安全', cn: '请带我去警察局', ko: '경찰서로 데려가 주세요', rd: 'gyeong-chal-seo-ro de-ryeo-ga-ju-se-yo' },
  { group: '紧急·安全', cn: '请带我去医院', ko: '병원에 데려가 주세요', rd: 'byeong-won-e de-ryeo-ga-ju-se-yo' },
  { group: '紧急·安全', cn: '这里不安全', ko: '여기는 안전하지 않아요', rd: 'yeo-gi-neun an-jeon-ha-ji a-na-yo' },
  // 问路 / 交通
  { group: '问路·交通', cn: 'XX 怎么走？（XX 换成地名）', ko: '(으)로 어떻게 가요?', rd: '...ro eo-tteok-ke ga-yo?' },
  { group: '问路·交通', cn: '我想去（地名）', ko: '(地名)에 가고 싶어요', rd: '...e ga-go sip-eo-yo' },
  { group: '问路·交通', cn: '最近的公交站在哪？', ko: '가장 가까운 버스 정류장은 어디예요?', rd: 'ga-jang ga-kka-un beo-seu jeong-ryu-jang-eun eo-di-ye-yo?' },
  { group: '问路·交通', cn: '最近的地铁站在哪？', ko: '가장 가까운 지하철역은 어디예요?', rd: 'ga-jang ga-kka-un ji-ha-cheol-yeok-eun eo-di-ye-yo?' },
  { group: '问路·交通', cn: '请帮我叫出租车', ko: '택시 좀 불러주세요', rd: 'taek-si jom bul-leo-ju-se-yo' },
  { group: '问路·交通', cn: '这离 XX 远吗？', ko: '여기서 (이)랑 멀어요?', rd: 'yeo-gi-seo ...rang meol-eo-yo?' },
  // 物品丢失
  { group: '物品丢失', cn: '我的东西丢了', ko: '물건을 잃어버렸어요', rd: 'mul-geon-eul ireo-beo-ryeoss-eo-yo' },
  { group: '物品丢失', cn: '我的钱包丢了', ko: '지갑을 잃어버렸어요', rd: 'ji-gab-eul ireo-beo-ryeoss-eo-yo' },
  { group: '物品丢失', cn: '我的手机丢了', ko: '휴대폰을 잃어버렸어요', rd: 'hyu-dae-pon-eul ireo-beo-ryeoss-eo-yo' },
  { group: '物品丢失', cn: '我的护照丢了', ko: '여권을 잃어버렸어요', rd: 'yeo-gwon-eul ireo-beo-ryeoss-eo-yo' },
  { group: '物品丢失', cn: '请帮我找一下', ko: '찾아주세요', rd: 'cha-ja-ju-se-yo' },
  // 找地方 / 其他
  { group: '找地方·其他', cn: '最近的药店在哪？', ko: '가장 가까운 약국은 어디예요?', rd: 'ga-jang ga-kka-un yak-guk-eun eo-di-ye-yo?' },
  { group: '找地方·其他', cn: '洗手间在哪？', ko: '화장실은 어디예요?', rd: 'hwa-jang-si-reun eo-di-ye-yo?' },
  { group: '找地方·其他', cn: '可以刷卡吗？', ko: '카드 돼요?', rd: 'ka-deu dwae-yo?' },
  { group: '找地方·其他', cn: '多少钱？', ko: '얼마예요?', rd: 'eol-ma-ye-yo?' },
]

/** 按 group 分组成「组名 → 行」 */
function groupPhrases(rows: PhraseRow[]): { group: string; items: PhraseRow[] }[] {
  const order: string[] = []
  const map = new Map<string, PhraseRow[]>()
  for (const r of rows) {
    if (!map.has(r.group)) {
      map.set(r.group, [])
      order.push(r.group)
    }
    map.get(r.group)!.push(r)
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }))
}

export function PlanHelpSheet() {
  const groups = groupPhrases(PHRASES)
  return (
    <div className={`${styles['help-page']}`}>
      <div className={`${styles.head}`}>
        <h1>备用信息 · 紧急联系与求助用语</h1>
        <div className={`${styles.sub}`}>
          无网络 / 语言不通时，把右侧「韩文」一栏直接指给身边的韩国人看即可沟通。
        </div>
      </div>

      <h2 className={`${styles.h2}`}>一、紧急联系电话（韩国）</h2>
      <table className={`${styles.tbl}`}>
        <thead>
          <tr>
            <th>项目</th>
            <th>号码</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {PHONES.map((p) => (
            <tr key={p.name}>
              <td className={`${styles['c-name']}`}>{p.name}</td>
              <td className={`${styles['c-num']}`}>{p.num}</td>
              <td className={`${styles['c-note']}`}>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={`${styles.h2}`}>二、中韩求助用语对照</h2>
      <p className={`${styles.tip}`}>
        读音列为近似罗马音，仅供自己开口参考；给韩国人看请直接指「韩文」一列。
      </p>
      {groups.map((g) => (
        <div className={`${styles.pgroup}`} key={g.group}>
          <div className={`${styles['pgroup-title']}`}>{g.group}</div>
          <table className={`${styles.tbl} ${styles['phrase-tbl']}`}>
            <thead>
              <tr>
                <th>中文</th>
                <th>韩文</th>
                <th>读音（近似）</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((r) => (
                <tr key={r.cn}>
                  <td className={`${styles['c-cn']}`}>{r.cn}</td>
                  <td className={`${styles['c-ko']}`}>{r.ko}</td>
                  <td className={`${styles['c-rd']}`}>{r.rd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className={`${styles.foot}`}>
        电话以出发前最新官方公布为准；中国驻济州总领馆领事保护与协助电话 +82-64-722-8802，
        外交部全球领事保护与服务应急热线 +86-10-12308 / +86-10-65612308。
      </div>
    </div>
  )
}
