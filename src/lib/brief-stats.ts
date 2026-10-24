/**
 * Shared brief delivery aggregation used by admin dashboard,
 * user detail panel, and admin heartbeat.
 */

interface BriefDeliveryRow {
  status: string;
  deliveryStatus: string | null;
}

export interface BriefAggResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  pending: number;
  delivered: number;
  bounced: number;
}

export function aggregateBriefDeliveries(deliveries: BriefDeliveryRow[]): BriefAggResult {
  let sent = 0, skipped = 0, failed = 0, pending = 0, delivered = 0, bounced = 0;
  for (const d of deliveries) {
    if (d.status === "sent") {
      sent++;
      if (d.deliveryStatus === "delivered") delivered++;
      else if (d.deliveryStatus === "bounced" || d.deliveryStatus === "complained") bounced++;
    } else if (d.status === "skipped") skipped++;
    else if (d.status === "failed") failed++;
    else if (d.status === "pending") pending++;
  }
  return { total: deliveries.length, sent, skipped, failed, pending, delivered, bounced };
}
