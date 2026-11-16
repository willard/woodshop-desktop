import { Fragment, useSyncExternalStore } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { helpArticle } from '@/help';
import { activeTheme, onThemeChange } from '@/lib/theme';

/** Inline `code` and **bold** spans inside article text. */
function Inline({ text, codeClass = 'bg-surface-0' }: { text: string; codeClass?: string }) {
    return (
        <>
            {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
                part.startsWith('`') && part.endsWith('`') ? (
                    <code key={i} className={`${codeClass} text-accent rounded px-1.5 py-0.5 text-sm`}>
                        {part.slice(1, -1)}
                    </code>
                ) : part.startsWith('**') && part.endsWith('**') ? (
                    <strong key={i} className="text-fg-strong font-semibold">
                        {part.slice(2, -2)}
                    </strong>
                ) : (
                    <Fragment key={i}>{part}</Fragment>
                ),
            )}
        </>
    );
}

export default function HelpArticlePage() {
    const { slug } = useParams({ strict: false }) as { slug: string };
    const article = helpArticle(slug);
    // Screenshots come in both themes; show the one that matches the page.
    const theme = useSyncExternalStore(onThemeChange, activeTheme);
    if (!article) {
        return (
            <p className="text-muted">
                No such article.{' '}
                <Link to="/help" className="text-accent">
                    Back to Help
                </Link>
            </p>
        );
    }
    return (
        <>
            <nav className="text-faint mb-4 text-sm">
                <Link to="/help" className="text-accent">
                    Help Center
                </Link>
                <span className="px-1.5">/</span>
                <span>{article.title}</span>
            </nav>
            <article className="max-w-2xl">
                <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                    <span aria-hidden="true">{article.icon}</span>
                    {article.title}
                </h1>
                {article.blocks.map((block, i) => {
                    switch (block.type) {
                        case 'h':
                            return (
                                <h2 key={i} className="text-accent mt-6 mb-2 font-semibold">
                                    {block.text}
                                </h2>
                            );
                        case 'p':
                            return (
                                <p key={i} className="text-muted mb-4 leading-relaxed">
                                    <Inline text={block.text} />
                                </p>
                            );
                        case 'ul':
                            return (
                                <ul key={i} className="mb-4 ml-1 space-y-1.5">
                                    {block.items.map((item, j) => (
                                        <li key={j} className="text-muted flex gap-2">
                                            <span
                                                className="bg-accent/70 mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                                                aria-hidden="true"
                                            />
                                            <span>
                                                <Inline text={item} />
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            );
                        case 'ol':
                            return (
                                <ol key={i} className="mb-4 ml-1 space-y-1.5">
                                    {block.items.map((item, j) => (
                                        <li key={j} className="text-muted flex gap-2.5">
                                            <span className="bg-accent/15 text-accent mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                                                {j + 1}
                                            </span>
                                            <span>
                                                <Inline text={item} />
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            );
                        case 'img':
                            return (
                                <figure key={i} className="mb-5">
                                    <img
                                        src={`/help/${block.src}-${theme}.webp`}
                                        alt={block.alt}
                                        loading="lazy"
                                        className="border-fg/10 w-full rounded-lg border"
                                        data-testid="help-image"
                                    />
                                    {block.caption && (
                                        <figcaption className="text-faint mt-1.5 text-xs">
                                            <Inline text={block.caption} />
                                        </figcaption>
                                    )}
                                </figure>
                            );
                        case 'code':
                            return (
                                <pre
                                    key={i}
                                    className="bg-surface-0 text-fg-strong mb-4 overflow-x-auto rounded-md p-3 text-sm"
                                >
                                    <code>{block.text}</code>
                                </pre>
                            );
                        case 'note':
                            return (
                                <p
                                    key={i}
                                    className="border-accent/60 bg-accent/5 text-muted mb-4 rounded-md border-l-2 px-3 py-2 text-sm"
                                >
                                    💡 <Inline text={block.text} codeClass="bg-surface-1" />
                                </p>
                            );
                    }
                })}
            </article>
        </>
    );
}
