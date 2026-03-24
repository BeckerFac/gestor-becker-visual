// Currency service: exchange rate fetching with BCRA API, in-memory cache, and fallback

const AVAILABLE_CURRENCIES = ['ARS', 'USD', 'EUR'] as const;
type Currency = typeof AVAILABLE_CURRENCIES[number];

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const BCRA_API_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';

// AFIP currency codes mapping
const AFIP_CURRENCY_MAP: Record<string, string> = {
  ARS: 'PES',
  USD: 'DOL',
  EUR: '060',
};

class CurrencyService {
  private cache = new Map<string, CachedRate>();
  private lastKnown = new Map<string, number>();

  getAvailableCurrencies(): readonly string[] {
    return AVAILABLE_CURRENCIES;
  }

  getAfipCurrencyCode(currency: string): string {
    return AFIP_CURRENCY_MAP[currency] || 'PES';
  }

  async getExchangeRate(currency: string, date?: string): Promise<number> {
    if (currency === 'ARS') return 1;

    const cacheKey = `${currency}_${date || 'latest'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rate;
    }

    try {
      const rate = await this.fetchFromBcra(currency, date);
      this.cache.set(cacheKey, { rate, fetchedAt: Date.now() });
      this.lastKnown.set(currency, rate);
      return rate;
    } catch (error) {
      console.error(`Failed to fetch exchange rate for ${currency}:`, error);
      // Fallback to last known value
      const fallback = this.lastKnown.get(currency);
      if (fallback) {
        console.warn(`Using last known rate for ${currency}: ${fallback}`);
        return fallback;
      }
      throw new Error(`No se pudo obtener la cotizacion para ${currency}`);
    }
  }

  async getAllRates(): Promise<Record<string, number>> {
    const rates: Record<string, number> = { ARS: 1 };
    for (const currency of AVAILABLE_CURRENCIES) {
      if (currency === 'ARS') continue;
      try {
        rates[currency] = await this.getExchangeRate(currency);
      } catch {
        const fallback = this.lastKnown.get(currency);
        if (fallback) rates[currency] = fallback;
      }
    }
    return rates;
  }

  private async fetchFromBcra(currency: string, date?: string): Promise<number> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const url = `${BCRA_API_URL}?fecha=${targetDate}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`BCRA API returned ${response.status}`);
      }

      const data: any = await response.json();
      const results = data?.results;

      if (!Array.isArray(results) || results.length === 0) {
        throw new Error('No results from BCRA API');
      }

      // Find the matching currency in the BCRA response
      // BCRA uses denomination descriptions like "Dolar Estadounidense", "Euro"
      const currencyMap: Record<string, string[]> = {
        USD: ['dolar estadounidense', 'dolar billete'],
        EUR: ['euro'],
      };

      const searchTerms = currencyMap[currency] || [];
      for (const result of results) {
        const detalle = result.detalle || [];
        for (const item of detalle) {
          const desc = (item.denominacion || '').toLowerCase();
          if (searchTerms.some((term: string) => desc.includes(term))) {
            // Use tipoCotizacion (sell rate) for conversion
            const rate = parseFloat(item.tipoCotizacion || item.tipoCambio || '0');
            if (rate > 0) return rate;
          }
        }
      }

      throw new Error(`Currency ${currency} not found in BCRA response`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const currencyService = new CurrencyService();
