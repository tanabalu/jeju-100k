import type { Tutorial, TutorialIconName } from '../lib/prep'
import styles from './Tutorial.module.less'

/**
 * 内置示意图标：48×48 线条图，统一 stroke，颜色跟着 currentColor。
 *
 * 为什么不直接用实拍图：能核实的实拍素材有限，宁可用「一看就懂的示意图」，
 * 也不放来源不明的图。真有实拍图时，在教程数据里给 step 填 `image` 就会优先用图。
 */
function Icon({ name }: { name: TutorialIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      {name === 'store' && (
        <g {...common}>
          <path d="M5 19 10 9h28l5 10" />
          <path d="M7 19h34v20a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V19Z" />
          <path d="M19 41V28h10v13" />
        </g>
      )}
      {name === 'card' && (
        <g {...common}>
          <rect x="6" y="14" width="36" height="22" rx="3" />
          <rect x="11" y="19" width="8" height="6" rx="1" />
          <path d="M11 31h11M30 31h7" />
        </g>
      )}
      {name === 'cash' && (
        <g {...common}>
          <rect x="5" y="13" width="38" height="22" rx="3" />
          <path d="M18 19l3 8 3-8 3 8 3-8" />
          <path d="M17 23h14M17 27h14" />
        </g>
      )}
      {name === 'receipt' && (
        <g {...common}>
          <path d="M12 8h24v30l-4-3-4 3-4-3-4 3-4-3-4 3V8Z" />
          <path d="M17 16h14M17 22h14M17 28h9" />
        </g>
      )}
      {name === 'check' && (
        <g {...common}>
          <circle cx="24" cy="24" r="16" />
          <path d="M16 24.5 22 30l10-11" />
        </g>
      )}
      {name === 'phone' && (
        <g {...common}>
          <rect x="15" y="5" width="18" height="38" rx="3" />
          <path d="M21 10h6M21 37h6" />
        </g>
      )}
      {name === 'bus' && (
        <g {...common}>
          <rect x="8" y="7" width="32" height="25" rx="3" />
          <path d="M8 19h32" />
          <circle cx="15" cy="36" r="3" />
          <circle cx="33" cy="36" r="3" />
        </g>
      )}
      {name === 'bell' && (
        <g {...common}>
          <path d="M24 8c-6 0-10 4-10 10v8l-3 5h26l-3-5v-8c0-6-4-10-10-10Z" />
          <path d="M20 36a4 4 0 0 0 8 0" />
          <path d="M24 5v3" />
        </g>
      )}
      {name === 'nfc' && (
        <g {...common}>
          <path d="M12 13a17 17 0 0 1 24 0" />
          <path d="M16 18a11 11 0 0 1 16 0" />
          <path d="M20 23a6 6 0 0 1 8 0" />
          <circle cx="24" cy="31" r="2.5" />
        </g>
      )}
      {name === 'sign' && (
        <g {...common}>
          <rect x="10" y="6" width="28" height="14" rx="2" />
          <path d="M16 13h16" />
          <path d="M24 20v22" />
        </g>
      )}
    </svg>
  )
}

/** 把站点相对路径补成可用 URL（子路径部署也能用） */
function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL || './'
  return file.startsWith('http') ? file : `${base}${file}`
}

/**
 * 图文教程正文：编号步骤 + 每步一张图（有实拍图用图，没有用内置示意图标）。
 * 由清单条目就地展开的那块面板渲染。
 */
export function TutorialBody({ tutorial }: { tutorial: Tutorial }) {
  return (
    <div className={`${styles['tut']}`}>
      {tutorial.summary && <p className={`${styles['tut-summary']}`}>{tutorial.summary}</p>}

      <ol className={`${styles['tut-steps']}`}>
        {tutorial.steps.map((s, i) => (
          <li className={`${styles['tut-step']}`} key={i}>
            <figure className={`${styles['tut-fig']}${s.image ? ` ${styles['is-photo']}` : ''}`}>
              {s.image ? (
                <img src={assetUrl(s.image)} alt={s.caption ?? s.text} loading="lazy" />
              ) : (
                <Icon name={s.icon ?? 'check'} />
              )}
            </figure>
            <div className={`${styles['tut-body']}`}>
              <span className={`${styles['tut-step-no']}`}>第 {i + 1} 步</span>
              <p className={`${styles['tut-text']}`}>{s.text}</p>
              {s.caption && <p className={`${styles['tut-caption']}`}>{s.caption}</p>}
            </div>
          </li>
        ))}
      </ol>

      {tutorial.tips && tutorial.tips.length > 0 && (
        <ul className={`${styles['tut-tips']}`}>
          {tutorial.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      {tutorial.warn && <p className={`${styles['tut-warn']}`}>{tutorial.warn}</p>}

      {tutorial.sources && tutorial.sources.length > 0 && (
        <div className={`${styles['tut-sources']}`}>
          <span>参考：</span>
          {tutorial.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
