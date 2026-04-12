-- CreateEnum
CREATE TYPE "StreamReplayStatus" AS ENUM ('NONE', 'RECORDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Stream" ADD COLUMN "livekitEgressId" TEXT,
ADD COLUMN "replayUrl" TEXT,
ADD COLUMN "replayDurationSec" INTEGER,
ADD COLUMN "replayStatus" "StreamReplayStatus" NOT NULL DEFAULT 'NONE';
