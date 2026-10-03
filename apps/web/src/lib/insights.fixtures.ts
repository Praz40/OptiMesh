// Responses of GET /api/v1/sites/{id}/forecast, /costs and /recommendations for the seeded Home site,
// produced by the API's own builders (build_forecast, build_costs, recommend in services/api/app) on
// 2026-10-04 in Europe/Sofia and serialized with model_dump(mode="json"), as FastAPI does. Typed
// literals, so a field that differs from lib/api.ts fails the typecheck.
// forecast + costs: 10:20 local, 7 hours of load history. costsNoMeter: same site without a grid meter.
// recommendationsSurplus: 13:05 exporting 3.4 kW. recommendationsPeak: 18:10 importing 9.8 kW.

import type { Costs, Forecast, Recommendation } from "./api";

export const forecastFixture: Forecast = {
  "site_id": "5e000000-0000-4000-8000-000000000001",
  "timezone": "Europe/Sofia",
  "currency": "EUR",
  "tariff": "Демо тарифа по часови зони",
  "generated_at": "2026-10-04T07:20:00Z",
  "interval_minutes": 60,
  "intervals": [
    {
      "start": "2026-10-04T10:00:00+03:00",
      "end": "2026-10-04T11:00:00+03:00",
      "solar_w": 3774.651205535525,
      "load_w": 3200.0,
      "import_price": 0.19,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T11:00:00+03:00",
      "end": "2026-10-04T12:00:00+03:00",
      "solar_w": 4601.189560842954,
      "load_w": 3200.0,
      "import_price": 0.13,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T12:00:00+03:00",
      "end": "2026-10-04T13:00:00+03:00",
      "solar_w": 5043.352364587878,
      "load_w": 3200.0,
      "import_price": 0.13,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T13:00:00+03:00",
      "end": "2026-10-04T14:00:00+03:00",
      "solar_w": 5043.352364587879,
      "load_w": 3200.0,
      "import_price": 0.13,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T14:00:00+03:00",
      "end": "2026-10-04T15:00:00+03:00",
      "solar_w": 4601.189560842954,
      "load_w": 3200.0,
      "import_price": 0.13,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T15:00:00+03:00",
      "end": "2026-10-04T16:00:00+03:00",
      "solar_w": 3774.651205535525,
      "load_w": 3200.0,
      "import_price": 0.21,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T16:00:00+03:00",
      "end": "2026-10-04T17:00:00+03:00",
      "solar_w": 2675.1703497188523,
      "load_w": 3200.0,
      "import_price": 0.21,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T17:00:00+03:00",
      "end": "2026-10-04T18:00:00+03:00",
      "solar_w": 1463.0586456527703,
      "load_w": 3200.0,
      "import_price": 0.32,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T18:00:00+03:00",
      "end": "2026-10-04T19:00:00+03:00",
      "solar_w": 361.3908441032552,
      "load_w": 3200.0,
      "import_price": 0.32,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T19:00:00+03:00",
      "end": "2026-10-04T20:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 3200.0,
      "import_price": 0.32,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T20:00:00+03:00",
      "end": "2026-10-04T21:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 3200.0,
      "import_price": 0.32,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T21:00:00+03:00",
      "end": "2026-10-04T22:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 3200.0,
      "import_price": 0.14,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T22:00:00+03:00",
      "end": "2026-10-04T23:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 3200.0,
      "import_price": 0.14,
      "export_price": 0.06
    },
    {
      "start": "2026-10-04T23:00:00+03:00",
      "end": "2026-10-05T00:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 3200.0,
      "import_price": 0.14,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T00:00:00+03:00",
      "end": "2026-10-05T01:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 420.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T01:00:00+03:00",
      "end": "2026-10-05T02:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 380.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T02:00:00+03:00",
      "end": "2026-10-05T03:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 360.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T03:00:00+03:00",
      "end": "2026-10-05T04:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 350.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T04:00:00+03:00",
      "end": "2026-10-05T05:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 360.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T05:00:00+03:00",
      "end": "2026-10-05T06:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 450.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T06:00:00+03:00",
      "end": "2026-10-05T07:00:00+03:00",
      "solar_w": 0.0,
      "load_w": 900.0,
      "import_price": 0.11,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T07:00:00+03:00",
      "end": "2026-10-05T08:00:00+03:00",
      "solar_w": 361.3908441032552,
      "load_w": 3200.0,
      "import_price": 0.19,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T08:00:00+03:00",
      "end": "2026-10-05T09:00:00+03:00",
      "solar_w": 1463.0586456527699,
      "load_w": 3200.0,
      "import_price": 0.19,
      "export_price": 0.06
    },
    {
      "start": "2026-10-05T09:00:00+03:00",
      "end": "2026-10-05T10:00:00+03:00",
      "solar_w": 2675.170349718851,
      "load_w": 3200.0,
      "import_price": 0.19,
      "export_price": 0.06
    }
  ],
  "assumptions": [
    "Цени: Демо тарифа по часови зони, в EUR/kWh по местно време (Europe/Sofia).",
    "Тарифата е измислена за демонстрацията: не е тарифа на доставчик, нито борсовите цени „ден напред“, които използва симулацията на сценария.",
    "Слънце: крива при ясно небе за 6 kW инвертори, намалена до 85% заради загуби. Облаците не се прогнозират.",
    "Консумация: 7 от 24 часа са средното за същия час през последната седмица; 17 са по текущата консумация."
  ]
};

export const costsFixture: Costs = {
  "site_id": "5e000000-0000-4000-8000-000000000001",
  "timezone": "Europe/Sofia",
  "currency": "EUR",
  "tariff": "Демо тарифа по часови зони",
  "day_start": "2026-10-04T00:00:00+03:00",
  "as_of": "2026-10-04T07:20:00Z",
  "has_meter": true,
  "intervals": [
    {
      "start": "2026-10-04T00:00:00+03:00",
      "end": "2026-10-04T01:00:00+03:00",
      "import_wh": 380.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.041800000000000004
    },
    {
      "start": "2026-10-04T01:00:00+03:00",
      "end": "2026-10-04T02:00:00+03:00",
      "import_wh": 350.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.0385
    },
    {
      "start": "2026-10-04T02:00:00+03:00",
      "end": "2026-10-04T03:00:00+03:00",
      "import_wh": 340.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.0374
    },
    {
      "start": "2026-10-04T03:00:00+03:00",
      "end": "2026-10-04T04:00:00+03:00",
      "import_wh": 330.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.0363
    },
    {
      "start": "2026-10-04T04:00:00+03:00",
      "end": "2026-10-04T05:00:00+03:00",
      "import_wh": 340.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.0374
    },
    {
      "start": "2026-10-04T05:00:00+03:00",
      "end": "2026-10-04T06:00:00+03:00",
      "import_wh": 420.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.0462
    },
    {
      "start": "2026-10-04T06:00:00+03:00",
      "end": "2026-10-04T07:00:00+03:00",
      "import_wh": 900.0,
      "export_wh": 0.0,
      "import_price": 0.11,
      "export_price": 0.06,
      "cost": 0.099
    },
    {
      "start": "2026-10-04T07:00:00+03:00",
      "end": "2026-10-04T08:00:00+03:00",
      "import_wh": 1500.0,
      "export_wh": 0.0,
      "import_price": 0.19,
      "export_price": 0.06,
      "cost": 0.28500000000000003
    },
    {
      "start": "2026-10-04T08:00:00+03:00",
      "end": "2026-10-04T09:00:00+03:00",
      "import_wh": 900.0,
      "export_wh": 0.0,
      "import_price": 0.19,
      "export_price": 0.06,
      "cost": 0.171
    },
    {
      "start": "2026-10-04T09:00:00+03:00",
      "end": "2026-10-04T10:00:00+03:00",
      "import_wh": 300.0,
      "export_wh": 650.0,
      "import_price": 0.19,
      "export_price": 0.06,
      "cost": 0.017999999999999995
    },
    {
      "start": "2026-10-04T10:00:00+03:00",
      "end": "2026-10-04T11:00:00+03:00",
      "import_wh": 610.0,
      "export_wh": 0.0,
      "import_price": 0.19,
      "export_price": 0.06,
      "cost": 0.1159
    }
  ],
  "import_wh": 6370.0,
  "export_wh": 650.0,
  "import_cost": 0.9655,
  "export_revenue": 0.039,
  "cost": 0.9265,
  "projected_day_cost": 5.446080238231861,
  "assumptions": [
    "Енергията се измерва на електромера към мрежата: взетата от мрежата — по брояча му на енергия (при липса или нулиране — по средната мощност), отдадената — по средната мощност за всеки час.",
    "Цени: Демо тарифа по часови зони; отдадената енергия се изкупува по 0,06 EUR/kWh.",
    "Часовете, за които електромерът не е изпратил данни, липсват и не се оценяват.",
    "Тарифата е измислена за демонстрацията: не е тарифа на доставчик, нито борсовите цени „ден напред“, които използва симулацията на сценария.",
    "Очакван разход за деня: разходът досега плюс прогнозното нетно потребление до края на деня, без батерията."
  ]
};

export const costsNoMeterFixture: Costs = {
  "site_id": "5e000000-0000-4000-8000-000000000001",
  "timezone": "Europe/Sofia",
  "currency": "EUR",
  "tariff": "Демо тарифа по часови зони",
  "day_start": "2026-10-04T00:00:00+03:00",
  "as_of": "2026-10-04T07:20:00Z",
  "has_meter": false,
  "intervals": [],
  "import_wh": 0.0,
  "export_wh": 0.0,
  "import_cost": 0.0,
  "export_revenue": 0.0,
  "cost": 0.0,
  "projected_day_cost": null,
  "assumptions": [
    "Енергията се измерва на електромера към мрежата: взетата от мрежата — по брояча му на енергия (при липса или нулиране — по средната мощност), отдадената — по средната мощност за всеки час.",
    "Цени: Демо тарифа по часови зони; отдадената енергия се изкупува по 0,06 EUR/kWh.",
    "Часовете, за които електромерът не е изпратил данни, липсват и не се оценяват.",
    "Тарифата е измислена за демонстрацията: не е тарифа на доставчик, нито борсовите цени „ден напред“, които използва симулацията на сценария.",
    "Обектът няма електромер към мрежата, затова разходът не се измерва."
  ]
};

export const recommendationsSurplusFixture: Recommendation[] = [
  {
    "id": "absorb-surplus:de000000-0000-4000-8000-000000001004",
    "rule": "absorb-surplus",
    "device_id": "de000000-0000-4000-8000-000000001004",
    "device_name": "EV charger",
    "title": "Увеличете „EV charger“ до 4,9 kW",
    "detail": "3,4 kW слънчева енергия се отдава към мрежата по 0,06 EUR/kWh. Ако колата се зарежда с нея, няма да се налага тази енергия да се купува обратно по-късно.",
    "action": {
      "type": "power_setpoint",
      "params": {
        "power_w": 4900.0
      }
    },
    "saving_per_hour": 0.39,
    "currency": "EUR"
  },
  {
    "id": "run-on-surplus:de000000-0000-4000-8000-000000001006",
    "rule": "run-on-surplus",
    "device_id": "de000000-0000-4000-8000-000000001006",
    "device_name": "Washing machine plug",
    "title": "Включете „Washing machine plug“ сега",
    "detail": "3,4 kW слънчева енергия се отдава към мрежата. Ако уредът работи сега, използва нея вместо енергия от мрежата по-късно.",
    "action": {
      "type": "switch",
      "params": {
        "on": true
      }
    },
    "saving_per_hour": 0.26,
    "currency": "EUR"
  }
];

export const recommendationsPeakFixture: Recommendation[] = [
  {
    "id": "defer-ev:de000000-0000-4000-8000-000000001004",
    "rule": "defer-ev",
    "device_id": "de000000-0000-4000-8000-000000001004",
    "device_name": "EV charger",
    "title": "Забавете „EV charger“ до 21:00",
    "detail": "Енергията от мрежата струва 0,32 EUR/kWh сега и около 0,14 EUR/kWh от 21:00. При 1,4 kW колата продължава да се зарежда; увеличете мощността отново по-късно.",
    "action": {
      "type": "power_setpoint",
      "params": {
        "power_w": 1400.0
      }
    },
    "saving_per_hour": 1.08,
    "currency": "EUR"
  },
  {
    "id": "pause-boiler:de000000-0000-4000-8000-000000001005",
    "rule": "pause-boiler",
    "device_id": "de000000-0000-4000-8000-000000001005",
    "device_name": "Water boiler",
    "title": "Изключете „Water boiler“ до 21:00",
    "detail": "Уредът взема 1,9 kW от мрежата при пикова цена (0,32 EUR/kWh). Топлата вода в бойлера стига за кратка пауза.",
    "action": {
      "type": "switch",
      "params": {
        "on": false
      }
    },
    "saving_per_hour": 0.35,
    "currency": "EUR"
  }
];
