import { Router } from 'express';
import { authRouter } from '../features/auth/authRoutes.js';
import { businessRouter } from '../features/business/businessRoutes.js';
import { orderRouter } from '../features/order/orderRoutes.js';
import { billingRouter } from '../features/billing/billingRoutes.js';
import { productRouter } from '../features/product/productRoutes.js';
import { notificationRouter } from '../features/notification/notificationRoutes.js';
import { deliveryRouter } from '../features/delivery/deliveryRoutes.js';

export const apiRouter = Router();

apiRouter.use(authRouter);
apiRouter.use(businessRouter);
apiRouter.use(orderRouter);
apiRouter.use(billingRouter);
apiRouter.use(productRouter);
apiRouter.use(notificationRouter);
apiRouter.use('/delivery', deliveryRouter);

