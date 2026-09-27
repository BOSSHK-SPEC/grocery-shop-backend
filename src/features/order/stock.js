import { Product } from '../../models/index.js';

/** A line cannot be fulfilled because stock ran out meanwhile. */
export class OutOfStockError extends Error {
  constructor(productName) {
    super(`${productName} just went out of stock. Please update your cart.`);
    this.code = 'OUT_OF_STOCK';
    this.status = 409;
  }
}

/**
 * Takes each line's quantity out of `inventoryCount`, locking the product rows
 * so two orders for the last unit cannot both succeed.
 *
 * `allowShortfall` is for orders that are already paid online: refusing them
 * now would take the money without an order, so stock is clamped at zero and
 * the store sees the shortfall instead.
 */
export async function reserveStock(lines, transaction, { allowShortfall = false } = {}) {
  for (const line of lines) {
    const qty = Math.round(Number(line.quantity ?? line.qty) || 0);
    if (!line.productId || qty <= 0) continue;
    const product = await Product.findByPk(line.productId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!product) continue;
    const stock = Number(product.inventoryCount) || 0;
    if (stock < qty && !allowShortfall) throw new OutOfStockError(product.productName);
    await product.update({ inventoryCount: Math.max(0, stock - qty) }, { transaction });
  }
}

/** Puts a cancelled order's lines back into stock. */
export async function releaseStock(lines, transaction) {
  for (const line of lines || []) {
    const qty = Math.round(Number(line.qty ?? line.quantity) || 0);
    if (!line.productId || qty <= 0) continue;
    const product = await Product.findByPk(line.productId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!product) continue;
    await product.update({ inventoryCount: (Number(product.inventoryCount) || 0) + qty }, { transaction });
  }
}
