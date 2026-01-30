/**
 * Format a number with K (thousands) or M (millions) suffix and commas
 * @param {number} num - The number to format
 * @returns {string} Formatted number (e.g., "1.2K", "3.5M", "1,234")
 */
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) {
    return '—'
  }

  const absNum = Math.abs(num)
  
  // For millions
  if (absNum >= 1000000) {
    const millions = num / 1000000
    return `${millions.toFixed(1)}M`
  }
  
  // For thousands
  if (absNum >= 1000) {
    const thousands = num / 1000
    return `${thousands.toFixed(1)}K`
  }
  
  // For numbers less than 1000, just add commas
  return num.toLocaleString('en-GB')
}

/**
 * Format a number with K (thousands) or M (millions) suffix with 2 decimal places for millions
 * Used specifically for GW rank to show more precision (e.g., "6.92M")
 * @param {number} num - The number to format
 * @returns {string} Formatted number (e.g., "1.23K", "6.92M", "1,234")
 */
export function formatNumberWithTwoDecimals(num) {
  if (num === null || num === undefined || isNaN(num)) {
    return '—'
  }

  const absNum = Math.abs(num)
  
  // For millions
  if (absNum >= 1000000) {
    const millions = num / 1000000
    return `${millions.toFixed(2)}M`
  }
  
  // For thousands
  if (absNum >= 1000) {
    const thousands = num / 1000
    return `${thousands.toFixed(1)}K`
  }
  
  // For numbers less than 1000, just add commas
  return num.toLocaleString('en-GB')
}

/**
 * Format a price value with pound sign, K/M suffix, and commas
 * @param {number|string} value - The price value (can be a number or string like "105.5")
 * @returns {string} Formatted price (e.g., "£105.5M", "£1.2K", "£1,234")
 */
export function formatPrice(value) {
  if (value === null || value === undefined || value === '—') {
    return '—'
  }

  // Convert string to number if needed
  const num = typeof value === 'string' ? parseFloat(value) : value
  
  if (isNaN(num)) {
    return '—'
  }

  const absNum = Math.abs(num)
  
  // For millions (>= 1,000,000)
  if (absNum >= 1000000) {
    const millions = num / 1000000
    return `£${millions.toFixed(1)}M`
  }
  
  // For thousands (>= 1,000 and < 1,000,000)
  if (absNum >= 1000) {
    const thousands = num / 1000
    return `£${thousands.toFixed(1)}K`
  }
  
  // For values between 1 and 1000, check if it's likely already in millions (team value format)
  // Team values in FPL are typically between 50-150, representing millions
  if (absNum >= 1 && absNum < 1000) {
    // If it's a reasonable team value range (50-200), treat as millions
    if (absNum >= 50 && absNum <= 200) {
      return `£${num.toFixed(1)}M`
    }
    // Otherwise, format as regular currency with commas
    return `£${num.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
  }
  
  // For very small numbers (less than 1), show as is with pound sign
  return `£${num.toFixed(1)}`
}
