import { Router } from 'express';
import { authRouter } from '../features/auth/authRoutes.js';
import { addressRouter } from '../features/address/addressRoutes.js';
import { favoritesRouter } from '../features/favorites/favoritesRoutes.js';
import { couponRouter } from '../features/coupon/couponRoutes.js';
import { businessRouter } from '../features/business/businessRoutes.js';
import { orderRouter } from '../features/order/orderRoutes.js';
import { billingRouter } from '../features/billing/billingRoutes.js';
import { productRouter } from '../features/product/productRoutes.js';
import { notificationRouter } from '../features/notification/notificationRoutes.js';
import { deliveryRouter } from '../features/delivery/deliveryRoutes.js';
import { paymentRouter } from '../features/payment/paymentRoutes.js';
import adminRouter from '../features/admin/adminRoutes.js';
import superAdminRouter from '../features/superAdmin/superAdminRoutes.js';

export const apiRouter = Router();

apiRouter.use(authRouter);
apiRouter.use(addressRouter);
apiRouter.use(favoritesRouter);
apiRouter.use(couponRouter);
apiRouter.use(businessRouter);
apiRouter.use(orderRouter);
apiRouter.use(billingRouter);
apiRouter.use(productRouter);
apiRouter.use(notificationRouter);
apiRouter.use('/delivery', deliveryRouter);
apiRouter.use(paymentRouter);
apiRouter.use(adminRouter);
apiRouter.use(superAdminRouter);

