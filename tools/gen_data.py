import csv
import json
import os
import random
from datetime import datetime, timedelta

random.seed(42)
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "synthetic")
os.makedirs(OUT, exist_ok=True)

FIRST = ["Rakesh", "Suresh", "Amit", "Vijay", "Rahul", "Deepak", "Sanjay", "Arjun"]
LAST = ["Sawant", "Sharma", "Patil", "Deshmukh", "Gaikwad", "More", "Jadhav", "Kamble"]
SYNDICATES = [f"S{i}" for i in range(1, 4)]


def person_name():
    return f"{random.choice(FIRST)} {random.choice(LAST)}"


def gen_persons(n=120):
    people = []
    for i in range(n):
        synd = random.choice(SYNDICATES) if i < 90 else None
        people.append({"id": f"P{i:03d}", "name": person_name(), "syndicate": synd})
    people[0]["name"] = "Rakesh Sawant"
    people[1]["name"] = "R. Sawant"
    people[1]["nafis_id"] = "NAFIS-0001"
    people[0]["nafis_id"] = "NAFIS-0001"
    return people


def gen_cdr(people, rows=40000):
    path = os.path.join(OUT, "cdr.csv")
    start = datetime(2024, 1, 1)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["caller_msisdn", "callee_msisdn", "start_ts", "duration_s", "call_type", "cell_id"])
        for _ in range(rows):
            a, b = random.sample(people, 2)
            ts = start + timedelta(minutes=random.randint(0, 90 * 1440))
            w.writerow([
                f"98{random.randint(10000000,99999999)}",
                f"98{random.randint(10000000,99999999)}",
                ts.isoformat(), random.randint(5, 600),
                random.choice(["VOICE", "SMS"]),
                f"CELL-{random.randint(1,40)}",
            ])
    return path


def gen_financial(rows=1200):
    path = os.path.join(OUT, "financial.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["from_account", "to_account", "amount", "currency", "ts", "channel"])
        for _ in range(rows):
            w.writerow([
                f"AC{random.randint(1000,9999)}", f"AC{random.randint(1000,9999)}",
                random.randint(1000, 200000), "INR",
                (datetime(2024, 1, 1) + timedelta(days=random.randint(0, 90))).isoformat(),
                random.choice(["UPI", "NEFT", "CASH"]),
            ])
        for _ in range(6):
            w.writerow(["AC5501", "AC7790", 49500, "INR",
                        (datetime(2024, 3, 10)).isoformat(), "NEFT"])
    return path


def gen_icjs(records=40):
    path = os.path.join(OUT, "icjs.json")
    data = [{"case_no": f"ICJS-{i:03d}", "linked_fir": f"FIR-{i:04d}"} for i in range(records)]
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return path


def gen_vahan(rows=60):
    path = os.path.join(OUT, "vahan.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["vehicle_no", "owner_name"])
        for _ in range(rows):
            w.writerow([f"MH{random.randint(1,20)}{random.choice('ABCDE')}{random.randint(1000,9999)}", person_name()])
    return path


def gen_nafis(rows=15):
    path = os.path.join(OUT, "nafis.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["nafis_id", "name"])
        for i in range(rows):
            w.writerow([f"NAFIS-{i:04d}", person_name()])
    return path


def gen_camera_topology():
    path = os.path.join(OUT, "camera_topology.json")
    cams = ["cam_01", "cam_02", "cam_03", "cam_04"]
    edges = [
        ("cam_01", "cam_02", 120, 20),
        ("cam_01", "cam_03", 240, 30),
        ("cam_02", "cam_04", 150, 25),
        ("cam_03", "cam_04", 200, 35),
        ("cam_01", "cam_04", 300, 40),
    ]
    data = {
        "cameras": [{"code": c, "label": c, "lat": 19.07 + random.random() * 0.1,
                     "lon": 72.87 + random.random() * 0.1} for c in cams],
        "edges": [{"from": a, "to": b, "mean_travel_s": m, "stddev_s": s} for a, b, m, s in edges],
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return path


def main():
    people = gen_persons()
    print("persons", len(people))
    print("cdr", gen_cdr(people))
    print("financial", gen_financial())
    print("icjs", gen_icjs())
    print("vahan", gen_vahan())
    print("nafis", gen_nafis())
    print("topology", gen_camera_topology())


if __name__ == "__main__":
    main()
