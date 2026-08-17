const getTimestamp = () => {
  return new Date().toISOString();
};

export const logger = {
  info: (...args: any[]) => {
    const timestamp = getTimestamp();
    console.log(`[${timestamp}] [INFO]`, ...args);
  },
  error: (...args: any[]) => {
    const timestamp = getTimestamp();
    console.error(`[${timestamp}] [ERROR]`, ...args);
  },
  warn: (...args: any[]) => {
    const timestamp = getTimestamp();
    console.warn(`[${timestamp}] [WARN]`, ...args);
  },
  debug: (...args: any[]) => {
    if (process.env.NODE_ENV !== "production") {
      const timestamp = getTimestamp();
      console.log(`[${timestamp}] [DEBUG]`, ...args);
    }
  },
};

