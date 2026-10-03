import ReactMarkdown from 'react-markdown'
import styles from './Markdown.module.less'

/**
 * 酒店介绍（intro）的 Markdown 渲染器。
 *
 * 介绍字段支持 Markdown 语法存储（标题 / 加粗 / 列表 / 链接等），这里统一渲染。
 * react-markdown 默认不解析原始 HTML（除非显式引入 rehype-raw），所以即使用户在
 * App 内改写介绍写了尖括号，也不会被当成 HTML 注入 —— 天然避免 XSS。
 * 链接统一在新标签页打开（target=_blank + rel=noopener）。
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.body}>
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
