import { Request, Response } from 'express';
import { Promotion } from '../../models/Promotion';

// Get all promotions
export const getAllPromotions = async (req: Request, res: Response) => {
  try {
    const { isActive, page = 1, limit = 20 } = req.query;

    const query: any = {};
    if (typeof isActive !== 'undefined') {
      query.isActive = isActive === 'true';
    }

    const promotions = await Promotion.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Promotion.countDocuments(query);

    res.json({
      promotions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get all promotions error:', error);
    res.status(500).json({ error: 'Failed to fetch promotions' });
  }
};

// Get promotion details
export const getPromotionDetails = async (req: Request, res: Response) => {
  try {
    const { promotionId } = req.params;

    const promotion = await Promotion.findById(promotionId);
    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    res.json({ promotion });
  } catch (error) {
    console.error('Get promotion details error:', error);
    res.status(500).json({ error: 'Failed to fetch promotion details' });
  }
};

// Create promotion
export const createPromotion = async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      discountType,
      discountValue,
      conditions,
      schedule,
      maxUsagePerUser,
      maxTotalUsage,
    } = req.body;

    if (!title || !description || !discountType || !discountValue) {
      return res.status(400).json({ 
        error: 'Title, description, discount type, and discount value are required' 
      });
    }

    const promotion = await Promotion.create({
      title,
      description,
      discountType,
      discountValue,
      conditions: conditions || {},
      schedule,
      maxUsagePerUser: maxUsagePerUser || 1,
      maxTotalUsage,
      isActive: true,
    });

    res.status(201).json({ promotion });
  } catch (error) {
    console.error('Create promotion error:', error);
    res.status(500).json({ error: 'Failed to create promotion' });
  }
};

// Update promotion
export const updatePromotion = async (req: Request, res: Response) => {
  try {
    const { promotionId } = req.params;
    const updates = req.body;

    const promotion = await Promotion.findByIdAndUpdate(
      promotionId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    res.json({ promotion });
  } catch (error) {
    console.error('Update promotion error:', error);
    res.status(500).json({ error: 'Failed to update promotion' });
  }
};

// Delete promotion
export const deletePromotion = async (req: Request, res: Response) => {
  try {
    const { promotionId } = req.params;

    const promotion = await Promotion.findByIdAndDelete(promotionId);
    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    res.json({ message: 'Promotion deleted successfully' });
  } catch (error) {
    console.error('Delete promotion error:', error);
    res.status(500).json({ error: 'Failed to delete promotion' });
  }
};

// Toggle promotion status
export const togglePromotionStatus = async (req: Request, res: Response) => {
  try {
    const { promotionId } = req.params;

    const promotion = await Promotion.findById(promotionId);
    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    promotion.isActive = !promotion.isActive;
    await promotion.save();

    res.json({ 
      message: `Promotion ${promotion.isActive ? 'activated' : 'deactivated'}`,
      promotion 
    });
  } catch (error) {
    console.error('Toggle promotion status error:', error);
    res.status(500).json({ error: 'Failed to toggle promotion status' });
  }
};
