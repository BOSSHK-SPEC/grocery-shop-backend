import { Notification } from '../../models/index.js';

export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page, limit } = req.query;

    const where = { userId };
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset
    });

    const unreadCount = await Notification.count({
      where: { userId, read: false }
    });

    return res.status(200).json({
      notifications: rows,
      unreadCount,
      pagination: {
        totalCount: count,
        totalPages: Math.ceil(count / limitNum),
        currentPage: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await Notification.findOne({
      where: { id, userId }
    });

    if (!notification) {
      return res.status(404).json({ error: { message: 'Notification not found' } });
    }

    await notification.update({ read: true });

    return res.status(200).json(notification);
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await Notification.update(
      { read: true },
      { where: { userId, read: false } }
    );

    return res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};
