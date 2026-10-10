/**
 * Renders the Markdown subset from `lib/markdown.ts` as React elements. There is no HTML string
 * anywhere: every piece of text goes through React's escaping, links pass the URL allow-list, and
 * images are never loaded (they are shown as links).
 */
import { Fragment, memo, useContext, useMemo, type ReactNode } from 'react';
import { InertLinksContext } from '../hooks/InertLinks';
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListItemNode,
  type TableAlign,
} from '../lib/markdown';
import { EXTERNAL_LINK_PROPS, sanitizeUrl } from '../lib/url';

const ALIGN_CLASS: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function alignClass(align: TableAlign | undefined): string | undefined {
  return align ? ALIGN_CLASS[align] : undefined;
}

/**
 * A link that passed the allow-list. In the online demo (`InertLinksContext`) the plan's content is
 * synthetic and its links point at pages that do not exist, so they are shown as text instead.
 */
function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  const inert = useContext(InertLinksContext);
  if (inert) {
    return (
      <span
        className="md-blocked-link"
        title="Links inside the synthetic demo content are switched off: they point at pages that do not exist."
      >
        {children}
      </span>
    );
  }
  return (
    <a href={href} {...EXTERNAL_LINK_PROPS}>
      {children}
    </a>
  );
}

function renderInline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{renderInlineNode(node)}</Fragment>);
}

function renderInlineNode(node: InlineNode): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong>{renderInline(node.children)}</strong>;
    case 'em':
      return <em>{renderInline(node.children)}</em>;
    case 'del':
      return <del>{renderInline(node.children)}</del>;
    case 'code':
      return <code>{node.text}</code>;
    case 'br':
      return <br />;
    case 'link': {
      // Defence in depth: the parser already allow-listed the URL; check again at the sink.
      const href = sanitizeUrl(node.href);
      if (href === null) {
        return (
          <span
            className="md-blocked-link"
            title="This link was not made clickable: its URL is not http, https or mailto."
          >
            {renderInline(node.children)}
          </span>
        );
      }
      return <SafeLink href={href}>{renderInline(node.children)}</SafeLink>;
    }
    case 'image': {
      const href = sanitizeUrl(node.href);
      const label = node.alt === '' ? 'image' : node.alt;
      if (href === null) {
        return (
          <span className="md-blocked-link" title="This image link was not made clickable.">
            [Image: {label}]
          </span>
        );
      }
      return <SafeLink href={href}>[Image: {label}]</SafeLink>;
    }
  }
}

function renderListItem(item: ListItemNode, index: number, headingOffset: number): ReactNode {
  const task = item.checked !== null;
  return (
    <li key={index} className={task ? 'md-task' : undefined}>
      {task ? (
        <>
          <span aria-hidden="true">{item.checked ? '☑ ' : '☐ '}</span>
          <span className="sr-only">{item.checked ? 'Done: ' : 'To do: '}</span>
        </>
      ) : null}
      {renderBlocks(item.children, headingOffset, true)}
    </li>
  );
}

function headingTag(level: number, headingOffset: number): 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const tag = Math.min(6, Math.max(2, level + headingOffset));
  return `h${tag}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

function renderBlocks(
  nodes: readonly BlockNode[],
  headingOffset: number,
  inItem = false,
): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'heading': {
        const Tag = headingTag(node.level, headingOffset);
        return (
          <Tag key={index} className={`md-h${node.level}`}>
            {renderInline(node.children)}
          </Tag>
        );
      }
      case 'paragraph':
        // A list item's first paragraph is rendered inline (tight list), like CommonMark.
        return inItem && index === 0 ? (
          <Fragment key={index}>{renderInline(node.children)}</Fragment>
        ) : (
          <p key={index}>{renderInline(node.children)}</p>
        );
      case 'blockquote':
        return <blockquote key={index}>{renderBlocks(node.children, headingOffset)}</blockquote>;
      case 'list': {
        const items = node.items.map((item, i) => renderListItem(item, i, headingOffset));
        return node.ordered ? (
          <ol key={index} start={node.start === 1 ? undefined : node.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case 'code_block':
        return (
          <pre
            key={index}
            tabIndex={0}
            role="region"
            aria-label={node.lang === '' ? 'Code' : `Code (${node.lang})`}
          >
            <code>{node.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={index} />;
      case 'table':
        return (
          <div key={index} className="overflow-x-auto">
            <table aria-label="Table in the task description">
              <thead>
                <tr>
                  {node.head.map((cell, c) => (
                    <th key={c} scope="col" className={alignClass(node.align[c])}>
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className={alignClass(node.align[c])}>
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export interface SafeMarkdownProps {
  source: string;
  /**
   * Added to a Markdown heading level to get the HTML heading level, so headings inside a task
   * description sit below the section heading in the page outline (default: `# ` becomes `<h4>`).
   */
  headingOffset?: number;
}

export const SafeMarkdown = memo(function SafeMarkdown({
  source,
  headingOffset = 3,
}: SafeMarkdownProps) {
  const nodes = useMemo(() => parseMarkdown(source), [source]);
  if (nodes.length === 0) return <p className="text-muted">This description is empty.</p>;
  return <div className="md">{renderBlocks(nodes, headingOffset)}</div>;
});
