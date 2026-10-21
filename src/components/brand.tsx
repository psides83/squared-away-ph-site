export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg width="34" height="38" viewBox="0 0 34 38" fill="none">
          <path
            d="M4 8V3h26v5M4 30v5h26v-5M10 12h14v14H10zM17 7v24"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="m13 19 4-4 4 4-4 4z" fill="currentColor" />
        </svg>
      </span>
      <span>
        <strong>SQUARED AWAY</strong>
        <small>PERFORMANCE HORSES</small>
      </span>
    </div>
  );
}
