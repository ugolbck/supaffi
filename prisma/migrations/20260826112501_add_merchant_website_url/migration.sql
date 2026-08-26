/*
  Warnings:

  - Added the required column `websiteUrl` to the `Merchant` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "websiteUrl" TEXT NOT NULL;
