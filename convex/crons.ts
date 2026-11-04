import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Recovers notification events whose scheduled dispatch/retry/timeout job never ran.
crons.interval("recover stuck automation events", { minutes: 10 }, internal.automation.sweepStuck, {});

export default crons;
