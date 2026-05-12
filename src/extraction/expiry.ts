// Detect token expiry from URL query parameters
export function detectExpiry(url: string): number | null {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    // exp= (epoch seconds)
    const exp = params.get('exp') ?? params.get('expires');
    if (exp) {
      const val = Number(exp);
      // If it looks like epoch seconds (> year 2000)
      if (val > 946_684_800 && val < 32_503_680_000) return val * 1000;
    }

    // X-Amz-Expires (relative seconds from X-Amz-Date)
    const amzExpires = params.get('X-Amz-Expires');
    const amzDate = params.get('X-Amz-Date');
    if (amzExpires && amzDate) {
      // X-Amz-Date format: 20240101T000000Z
      const dateMatch = amzDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      if (dateMatch) {
        const date = new Date(
          `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${dateMatch[4]}:${dateMatch[5]}:${dateMatch[6]}Z`
        );
        return date.getTime() + Number(amzExpires) * 1000;
      }
    }

    return null;
  } catch {
    return null;
  }
}
