// Runtime validation for Trade payloads received over the network.
import { z } from "zod";

export const LegPayloadSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["call", "put"]),
  side: z.enum(["long", "short"]),
  strike: z.number().finite().nonnegative().max(1_000_000),
  expiration: z.string().min(1),
  quantity: z.number().int().positive().max(10_000),
  premium: z.number().finite().nonnegative().max(100_000),
  iv: z.number().finite().nullable().optional(),
});

export const TradePayloadSchema = z.object({
  id: z.string().optional(),
  symbol: z.string().min(1).max(20),
  underlyingPrice: z.number().finite().positive().max(1_000_000),
  riskFreeRate: z.number().finite().min(-1).max(1),
  legs: z.array(LegPayloadSchema).min(1).max(10),
  underlying: z
    .object({
      shares: z.number().int().min(0).max(1_000_000),
      costBasis: z.number().finite().nonnegative().max(1_000_000),
    })
    .nullable()
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
  ticketImagePath: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type TradePayload = z.infer<typeof TradePayloadSchema>;
