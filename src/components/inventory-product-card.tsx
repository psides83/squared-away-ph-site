import Link from "next/link";
import { Package, PackagePlus, Settings2, Scale } from "lucide-react";
import { money } from "@/lib/format";
export function InventoryProductCard({
  product,
  quantity,
  value,
}: {
  product: { id: string; name: string; category: string; archived: boolean };
  quantity: number;
  value: number;
}) {
  return (
    <article className="inventory-product-card">
      <div className="inventory-card-heading">
        <span className="app-icon-tile">
          <Package size={21} />
        </span>
        <span className="tag">
          {product.category}
          {product.archived ? " · Archived" : ""}
        </span>
      </div>
      <h3>{product.name}</h3>
      <div className="inventory-on-hand">
        <strong>
          {(quantity / 16).toLocaleString("en-US", {
            maximumFractionDigits: 4,
          })}
          <small>lb on hand</small>
        </strong>
        <span>
          {quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })} oz
          total
        </span>
      </div>
      <dl className="inventory-card-metrics">
        <div>
          <dt>Stock value</dt>
          <dd>{money(value)}</dd>
        </div>
        <div>
          <dt>Average / lb</dt>
          <dd>
            {quantity
              ? `$${(((value / quantity) * 16) / 100).toFixed(4)}`
              : "No stock"}
          </dd>
        </div>
      </dl>
      <div className="inventory-card-actions">
        {product.archived ? (
          <button
            type="button"
            className="button"
            disabled
            aria-label="Record stock unavailable while product is archived"
          >
            <PackagePlus size={17} />
            Record stock
          </button>
        ) : (
          <Link
            className="button"
            href={`/admin/inventory?product=${product.id}#stock-entry`}
          >
            <PackagePlus size={17} />
            Record stock
          </Link>
        )}
        <Link
          className="button secondary"
          href={`/admin/inventory?product=${product.id}#product-setup`}
        >
          <Settings2 size={17} />
          Manage product
        </Link>
        <Link
          className="button tertiary"
          href={`/admin/inventory?product=${product.id}&section=conversions#product-setup`}
        >
          <Scale size={17} />
          Conversions
        </Link>
      </div>
    </article>
  );
}
