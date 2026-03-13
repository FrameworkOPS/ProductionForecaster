/**
 * Calculation utilities for crew ramp-up/down and revenue
 */

/**
 * Calculate crew ramp-up multiplier based on crew type and training period
 * @param crewType - 'shingle' (fast) or 'metal' (slow)
 * @param daysElapsed - Days since crew start_date
 * @param trainingPeriodDays - Total training period duration
 * @returns Multiplier between 0.0 and 1.0 representing capacity percentage
 */
export function calculateCrewRampUpMultiplier(
  crewType: 'shingle' | 'metal',
  daysElapsed: number,
  trainingPeriodDays: number
): number {
  // If training period has passed, return 1.0 (full capacity)
  if (daysElapsed >= trainingPeriodDays) {
    return 1.0;
  }

  // Negative days (future crew) = 0 capacity
  if (daysElapsed < 0) {
    return 0.0;
  }

  // Linear ramp over training period
  const progressRatio = daysElapsed / trainingPeriodDays;

  if (crewType === 'shingle') {
    // Shingle crews ramp up fast: 30% max loss over training period
    // Day 0: 0.70 capacity, ramping to 1.0 by end of training
    return 0.70 + progressRatio * 0.30;
  } else {
    // Metal crews ramp up slowly: 60% max loss over training period
    // Day 0: 0.40 capacity, ramping to 1.0 by end of training
    return 0.40 + progressRatio * 0.60;
  }
}

/**
 * Calculate crew ramp-down multiplier as they approach terminate_date
 * @param terminateDate - Date when crew terminates
 * @param currentDate - Current date (default: today)
 * @returns Multiplier between 0.0 and 1.0 representing remaining capacity
 */
export function calculateCrewRampDownMultiplier(
  terminateDate: Date | string,
  currentDate: Date = new Date()
): number {
  const terminate = new Date(terminateDate);
  const today = new Date(currentDate);

  // Set times to start of day for accurate calculation
  terminate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const daysUntilTerminate = Math.floor(
    (terminate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If terminate date has passed, return 0.0 (no capacity)
  if (daysUntilTerminate < 0) {
    return 0.0;
  }

  // Ramp down over 30 days
  const rampDownPeriod = 30;

  if (daysUntilTerminate >= rampDownPeriod) {
    // More than 30 days out = full capacity
    return 1.0;
  }

  // Linear ramp down: full capacity at 30 days out, 0 at terminate date
  return daysUntilTerminate / rampDownPeriod;
}

/**
 * Check if crew is blocked by custom projects during a date range
 * @param crewId - Crew ID
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @param projects - Array of active custom projects
 * @returns true if crew has blocking project during period
 */
export function isCrewBlockedByProject(
  crewId: string,
  startDate: Date | string,
  endDate: Date | string,
  projects: Array<{ crew_id: string; start_date: Date | string; end_date: Date | string }>
): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  for (const project of projects) {
    // Only check projects for this crew
    if (project.crew_id !== crewId) {
      continue;
    }

    const projectStart = new Date(project.start_date);
    const projectEnd = new Date(project.end_date);
    projectStart.setHours(0, 0, 0, 0);
    projectEnd.setHours(0, 0, 0, 0);

    // Check for date overlap
    // Overlap exists if: period start < project end AND period end > project start
    if (start <= projectEnd && end >= projectStart) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate revenue for a job based on square footage and revenue per sq
 * @param squareFootage - Square footage of job
 * @param revenuePerSq - Revenue per square foot
 * @returns Total revenue
 */
export function calculateRevenuePerJob(
  squareFootage: number,
  revenuePerSq: number
): number {
  return squareFootage * revenuePerSq;
}

/**
 * Combine ramp-up and ramp-down multipliers for effective crew capacity
 * @param rampUpMultiplier - Ramp-up multiplier (0.0-1.0)
 * @param rampDownMultiplier - Ramp-down multiplier (0.0-1.0)
 * @param isBlockedByProject - Whether crew is blocked by custom project
 * @returns Combined effective multiplier
 */
export function calculateEffectiveCrewCapacity(
  rampUpMultiplier: number,
  rampDownMultiplier: number,
  isBlockedByProject: boolean = false
): number {
  if (isBlockedByProject) {
    return 0.0; // Hard block during project
  }

  // Multiply both multipliers together for combined effect
  return rampUpMultiplier * rampDownMultiplier;
}

/**
 * Calculate days between two dates
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Number of days (can be negative if endDate is before startDate)
 */
export function daysBetween(startDate: Date | string, endDate: Date | string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate lead time for a pipeline item
 * @param addedDate - When item was added to pipeline
 * @param estimatedCompletionDays - Estimated days to complete
 * @param currentDate - Current date (default: today)
 * @returns Lead time in days
 */
export function calculateLeadTime(
  addedDate: Date | string,
  estimatedCompletionDays: number,
  currentDate: Date = new Date()
): number {
  const daysElapsed = daysBetween(addedDate, currentDate);
  return daysElapsed + estimatedCompletionDays;
}

/**
 * Calculate queue growth: (pipeline + sales forecast) - production rate
 * @param pipelineSQs - Current square footage in pipeline
 * @param salesForecastSQs - Projected sales this period
 * @param productionRateSQs - Expected production rate
 * @returns Queue growth (positive = backlog increase, negative = reduction)
 */
export function calculateQueueGrowth(
  pipelineSQs: number,
  salesForecastSQs: number,
  productionRateSQs: number
): number {
  return pipelineSQs + salesForecastSQs - productionRateSQs;
}

/**
 * Calculate capacity utilization
 * @param actualProductionSQs - Actual square footage produced this period
 * @param crewCapacitySQs - Total crew capacity for period
 * @returns Utilization as decimal between 0.0 and 1.0
 */
export function calculateCapacityUtilization(
  actualProductionSQs: number,
  crewCapacitySQs: number
): number {
  if (crewCapacitySQs === 0) {
    return 0.0;
  }

  const utilization = actualProductionSQs / crewCapacitySQs;
  // Cap at 1.0 (100%) even if production exceeds capacity
  return Math.min(utilization, 1.0);
}

/**
 * Detect production bottleneck based on queue growth trend
 * @param currentQueueGrowth - Current period queue growth
 * @param previousQueueGrowth - Previous period queue growth (nullable)
 * @param capacityUtilization - Current capacity utilization (0.0-1.0)
 * @returns Tuple of [bottleneckDetected, bottleneckReason]
 */
export function detectProductionBottleneck(
  currentQueueGrowth: number,
  previousQueueGrowth: number | null,
  capacityUtilization: number
): [boolean, string | null] {
  // Check for sustained queue growth (2+ consecutive periods)
  if (currentQueueGrowth > 0 && previousQueueGrowth !== null && previousQueueGrowth > 0) {
    return [true, 'Queue backlog building for 2+ consecutive weeks'];
  }

  // Check for high capacity utilization
  if (capacityUtilization >= 0.9) {
    return [true, 'Capacity at or above 90% utilization'];
  }

  // Check for sustained high queue (even if not growing)
  if (currentQueueGrowth > 100) {
    // Arbitrary threshold: > 100 SQs queued
    return [true, 'Large queue backlog detected'];
  }

  return [false, null];
}

/**
 * Calculate production rate based on historical actuals
 * @param historicalData - Array of production SQs for past periods
 * @returns Average production rate
 */
export function calculateAverageProductionRate(historicalData: number[]): number {
  if (historicalData.length === 0) {
    return 0;
  }

  const sum = historicalData.reduce((acc, val) => acc + val, 0);
  return sum / historicalData.length;
}
