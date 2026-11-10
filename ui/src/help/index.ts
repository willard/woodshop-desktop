/** The Help Center: articles as structured blocks, so the renderer owns all styling. */
import articles from './articles.json';

export type HelpBlock =
    { type: 'h' | 'p' | 'code' | 'note'; text: string } | { type: 'ul' | 'ol'; items: string[] };

export interface HelpArticle {
    slug: string;
    title: string;
    icon: string;
    summary: string;
    blocks: HelpBlock[];
}

export const HELP_ARTICLES = articles as HelpArticle[];

export function helpArticle(slug: string): HelpArticle | undefined {
    return HELP_ARTICLES.find((a) => a.slug === slug);
}
