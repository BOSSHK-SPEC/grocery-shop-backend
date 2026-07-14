import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Bill, Product, sequelize } from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';

export const getBills = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { search, startDate, endDate, page, limit } = req.query;

    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const where = { businessId: business.id };

    if (search) {
      where[Op.or] = [
        { customerName: { [Op.like]: `%${search}%` } },
        { mobile: { [Op.like]: `%${search}%` } },
        { billCode: { [Op.like]: `%${search}%` } }
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt[Op.lte] = end;
      }
    }

    let bills;
    let pagination = null;

    if (page || limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const offset = (pageNum - 1) * limitNum;

      const { count, rows } = await Bill.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: limitNum,
        offset
      });

      bills = rows;
      pagination = {
        totalCount: count,
        totalPages: Math.ceil(count / limitNum),
        currentPage: pageNum,
        limit: limitNum
      };
    } else {
      bills = await Bill.findAll({
        where,
        order: [['createdAt', 'DESC']]
      });
    }

    return res.status(200).json({
      bills,
      pagination
    });
  } catch (error) {
    next(error);
  }
};

export const createBill = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const schema = z.object({
      customerName: z.string(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      rows: z.array(z.any())
    });
    const data = schema.parse(req.body);
    const billCode = `BILL-${Math.floor(100000 + Math.random() * 900000)}`;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    
    const newBill = await Bill.create({
      businessId: business.id,
      billCode,
      customerName: data.customerName,
      mobile: data.mobile,
      amount: data.amount,
      date,
      rows: data.rows
    }, { transaction });

     // Deduct quantities
     for (const row of data.rows) {
       const qty = parseFloat(row.qty) || 0;
       console.log(`[Deduction] Row details - productId: ${row.productId}, item: ${row.item}, qty: ${qty}`);
       if (qty <= 0) continue;
 
       let product;
       if (row.productId) {
         product = await Product.findOne({
           where: { id: row.productId, businessId: business.id },
           transaction
         });
       }
       
       if (!product && row.item) {
         product = await Product.findOne({
           where: { productName: row.item, businessId: business.id },
           transaction
         });
       }
 
       if (product) {
         const oldQty = product.totalQuantity;
         const newQty = Math.max(0, oldQty - qty);
         console.log(`[Deduction] Found product ${product.productName} (ID: ${product.id}). Old Qty: ${oldQty}, Deducting: ${qty}, New Qty: ${newQty}`);
         await product.update({ totalQuantity: newQty }, { transaction });
       } else {
         console.log(`[Deduction] Product NOT found in catalog!`);
       }
     }

    await transaction.commit();
    return res.status(201).json(newBill);
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

export const getBillById = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({
      where: { id: billId, businessId: business.id }
    });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    return res.status(200).json(bill);
  } catch (error) {
    next(error);
  }
};

export const updateBill = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ 
      where: { id: billId, businessId: business.id },
      transaction
    });
    if (!bill) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    const schema = z.object({
      customerName: z.string().optional(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0).optional(),
      rows: z.array(z.any()).optional()
    });
    const data = schema.parse(req.body);

    if (data.rows) {
      // 1. Revert old bill items
      const oldRows = bill.rows || [];
      for (const row of oldRows) {
        const qty = parseFloat(row.qty) || 0;
        if (qty <= 0) continue;

        let product;
        if (row.productId) {
          product = await Product.findOne({
            where: { id: row.productId, businessId: business.id },
            transaction
          });
        }
        if (!product && row.item) {
          product = await Product.findOne({
            where: { productName: row.item, businessId: business.id },
            transaction
          });
        }

        if (product) {
          await product.update({ totalQuantity: product.totalQuantity + qty }, { transaction });
        }
      }

      // 2. Deduct new bill items
      for (const row of data.rows) {
        const qty = parseFloat(row.qty) || 0;
        if (qty <= 0) continue;

        let product;
        if (row.productId) {
          product = await Product.findOne({
            where: { id: row.productId, businessId: business.id },
            transaction
          });
        }
        if (!product && row.item) {
          product = await Product.findOne({
            where: { productName: row.item, businessId: business.id },
            transaction
          });
        }

        if (product) {
          const newQty = Math.max(0, product.totalQuantity - qty);
          await product.update({ totalQuantity: newQty }, { transaction });
        }
      }
    }

    await bill.update({
      ...(data.customerName && { customerName: data.customerName }),
      ...(data.mobile !== undefined && { mobile: data.mobile }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.rows && { rows: data.rows }),
    }, { transaction });

    await transaction.commit();
    return res.status(200).json(bill);
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

export const deleteBill = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ 
      where: { id: billId, businessId: business.id },
      transaction
    });
    if (!bill) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }

    // Revert old bill items
    const oldRows = bill.rows || [];
    for (const row of oldRows) {
      const qty = parseFloat(row.qty) || 0;
      if (qty <= 0) continue;

      let product;
      if (row.productId) {
        product = await Product.findOne({
          where: { id: row.productId, businessId: business.id },
          transaction
        });
      }
      if (!product && row.item) {
        product = await Product.findOne({
          where: { productName: row.item, businessId: business.id },
          transaction
        });
      }

      if (product) {
        await product.update({ totalQuantity: product.totalQuantity + qty }, { transaction });
      }
    }

    await bill.destroy({ transaction });
    await transaction.commit();
    return res.status(200).json({ message: 'Bill deleted successfully' });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};
