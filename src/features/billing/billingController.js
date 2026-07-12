import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Bill } from '../../models/index.js';
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
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
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
    });
    return res.status(201).json(newBill);
  } catch (error) {
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
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ where: { id: billId, businessId: business.id } });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    const schema = z.object({
      customerName: z.string().optional(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0).optional(),
      rows: z.array(z.any()).optional()
    });
    const data = schema.parse(req.body);
    await bill.update({
      ...(data.customerName && { customerName: data.customerName }),
      ...(data.mobile !== undefined && { mobile: data.mobile }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.rows && { rows: data.rows }),
    });
    return res.status(200).json(bill);
  } catch (error) {
    next(error);
  }
};

export const deleteBill = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ where: { id: billId, businessId: business.id } });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    await bill.destroy();
    return res.status(200).json({ message: 'Bill deleted successfully' });
  } catch (error) {
    next(error);
  }
};
