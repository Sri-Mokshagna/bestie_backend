import { Request, Response } from 'express';
import { Report, ReportStatus } from '../../models/Report';
import { User } from '../../models/User';
import { logger } from '../../lib/logger';

// Get all reported users with details
export const getReportedUsers = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query: any = {};
    if (status) {
      query.status = status;
    }

    const reports = await Report.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // Batch fetch all users involved
    const userIds = new Set<string>();
    reports.forEach(r => {
      userIds.add(r.reporterId.toString());
      userIds.add(r.reportedUserId.toString());
    });

    const users = await User.find({ _id: { $in: Array.from(userIds) } })
      .select('profile phone role status')
      .lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const reportsWithUsers = reports.map(report => {
      const reporter = userMap.get(report.reporterId.toString());
      const reportedUser = userMap.get(report.reportedUserId.toString());
      return {
        id: report._id,
        reporter: {
          id: report.reporterId,
          name: reporter?.profile?.name || 'Unknown',
          phone: reporter?.phone || '',
        },
        reportedUser: {
          id: report.reportedUserId,
          name: reportedUser?.profile?.name || 'Unknown',
          phone: reportedUser?.phone || '',
          role: reportedUser?.role,
          status: reportedUser?.status,
        },
        reason: report.reason,
        description: report.description,
        status: report.status,
        adminNotes: report.adminNotes,
        createdAt: report.createdAt,
      };
    });

    const total = await Report.countDocuments(query);

    res.json({
      reports: reportsWithUsers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Get reported users error');
    res.status(500).json({ error: 'Failed to fetch reported users' });
  }
};

// Update report status
export const updateReportStatus = async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const { status, adminNotes } = req.body;
    const adminId = (req as any).user?.id;

    if (!Object.values(ReportStatus).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await Report.findByIdAndUpdate(
      reportId,
      {
        status,
        adminNotes,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    logger.info({ reportId, status, adminId }, 'Report status updated');

    res.json({ message: 'Report updated', report });
  } catch (error) {
    logger.error({ error }, 'Update report status error');
    res.status(500).json({ error: 'Failed to update report' });
  }
};
