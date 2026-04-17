import { Request } from "express";

export interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan: string;
    language: string;
    currency: string;
  };
}

export interface AdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
