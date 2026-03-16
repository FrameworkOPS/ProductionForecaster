// Mock API for testing without backend
const MOCK_USERS = {
  'test@example.com': {
    userId: 'mock-user-1',
    email: 'test@example.com',
    password: 'password',
    firstName: 'Test',
    lastName: 'User',
    role: 'admin',
  },
}

const MOCK_TOKEN = 'mock-jwt-token-' + Math.random().toString(36).substr(2, 9)

export async function mockLogin(email: string, password: string) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500))

  const user = MOCK_USERS[email as keyof typeof MOCK_USERS]
  if (!user || user.password !== password) {
    throw new Error('Invalid email or password')
  }

  return {
    data: {
      token: MOCK_TOKEN,
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
    },
  }
}

export async function mockRegister(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string
) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500))

  const newUser = {
    userId: 'mock-user-' + Math.random().toString(36).substr(2, 9),
    email,
    password,
    firstName: firstName || '',
    lastName: lastName || '',
    role: 'viewer',
  }

  // In real mock, we'd store this, but for testing we just return success
  return {
    data: {
      token: MOCK_TOKEN,
      user: {
        userId: newUser.userId,
        email: newUser.email,
        role: newUser.role,
      },
    },
  }
}

export async function mockGetMetrics() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300))

  return {
    data: {
      totalJobs: 42,
      activeJobs: 15,
      completedJobs: 27,
      avgCompletionTime: 5.2,
      teamCapacity: 85,
      forecasted: 94,
      actual: 88,
      forecastAccuracy: 93.6,
    },
  }
}

export async function mockGetForecasts() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300))

  return {
    data: [
      {
        id: 'forecast-1',
        forecastDate: new Date().toISOString().split('T')[0],
        predictedCapacity: 92,
        predictedRevenue: 45000,
        confidenceScore: 0.95,
        bottleneckDetected: false,
      },
      {
        id: 'forecast-2',
        forecastDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        predictedCapacity: 88,
        predictedRevenue: 42000,
        confidenceScore: 0.92,
        bottleneckDetected: false,
      },
    ],
  }
}

export async function mockGetJobs() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300))

  return {
    data: [
      {
        id: 'job-1',
        name: 'Residential Roof - 3000 SQS',
        revenue: 15000,
        status: 'In Progress',
        progress: 65,
      },
      {
        id: 'job-2',
        name: 'Commercial Building - 5000 SQS',
        revenue: 28000,
        status: 'Scheduled',
        progress: 0,
      },
      {
        id: 'job-3',
        name: 'Warehouse Repair - 2000 SQS',
        revenue: 12000,
        status: 'Completed',
        progress: 100,
      },
    ],
  }
}
