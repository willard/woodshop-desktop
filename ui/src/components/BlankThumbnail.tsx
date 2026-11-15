/** The stand-in picture for a project or template that has none yet. */

/** A cabinet, drawn in a few lines. */
export function BlankThumbnail() {
    return (
        <svg
            viewBox="0 0 120 80"
            className="text-fg/20 h-1/2 w-auto"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            aria-hidden="true"
            data-testid="project-thumb-blank"
        >
            {/* Carcase in three-quarter view, a drawer line, a door line, two knobs. */}
            <path d="M40 22 L76 14 L96 22 L60 30 Z" />
            <path d="M40 22 L40 62 L60 70 L60 30" />
            <path d="M60 70 L96 62 L96 22" />
            <path d="M60 40 L96 32" />
            <path d="M78 36 L78 66" />
            <circle cx="70" cy="44" r="1.4" fill="currentColor" />
            <circle cx="86" cy="42" r="1.4" fill="currentColor" />
        </svg>
    );
}
