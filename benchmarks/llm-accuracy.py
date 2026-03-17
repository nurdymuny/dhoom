#!/usr/bin/env python3
"""
DHOOM LLM Accuracy Benchmark — 209-question retrieval methodology

Encodes the same five datasets in JSON, TOON, and DHOOM, then asks an LLM
209 structured retrieval questions per format.  Compares answers to ground
truth and reports accuracy per format × model.

Usage:
    pip install anthropic python-dotenv
    python benchmarks/llm-accuracy.py [--dry-run] [--model claude-sonnet-4-20250514]

Environment variables (.env):
    ANTHROPIC_API_KEY  – required for Claude models
    OPENAI_API_KEY     – optional, for GPT models (future)
    GEMINI_API_KEY     – optional, for Gemini models (future)
"""

import os
import sys
import json
import time
import argparse
import re
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # user can set env vars manually

try:
    import anthropic
except ImportError:
    anthropic = None

try:
    import openai as openai_mod
except ImportError:
    openai_mod = None

# ───────────────────────────────────────────────────────────────────────────
# Datasets (source of truth — identical to token-count.py)
# ───────────────────────────────────────────────────────────────────────────

DATASETS = {
    "Customer Reviews": {
        "reviews": [
            {"id": 101, "customer": "Alex Rivera", "rating": 5, "comment": "Excellent!", "verified": True},
            {"id": 102, "customer": "Brij Pandey", "rating": 5, "comment": "Game changer!", "verified": True},
            {"id": 103, "customer": "Casey Lee", "rating": 3, "comment": "Average", "verified": False},
        ]
    },
    "Sensor Readings": {
        "readings": [
            {"sensor_id": "T-001", "timestamp": 1710000000, "value": 22.4, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-002", "timestamp": 1710000060, "value": 23.1, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-003", "timestamp": 1710000120, "value": 45.8, "status": "alert", "unit": "celsius"},
        ]
    },
    "User Profiles": {
        "users": [
            {"id": 201, "name": "Dana Kim", "email": "dana@example.com", "role": "admin", "active": True},
            {"id": 202, "name": "Eli Rosenberg", "email": "eli@example.com", "role": "editor", "active": True},
            {"id": 203, "name": "Farah Nassar", "email": "farah@example.com", "role": "viewer", "active": True},
        ]
    },
    "Nested Order": {
        "order": [
            {
                "id": "ORD-7891",
                "customer": "Diana Prince",
                "total": 149.99,
                "items": [
                    {"sku": "A100", "name": "Widget", "qty": 2, "price": 49.99},
                    {"sku": "A101", "name": "Gadget", "qty": 1, "price": 50.01},
                ],
                "shipping": [
                    {"method": "express", "address": "1234 Elm St"},
                ],
            }
        ]
    },
    "API Response": {
        "posts": [
            {"id": 1, "author": "jpark", "title": "Intro to DHOOM", "likes": 42, "published": True},
            {"id": 2, "author": "beedavis", "title": "Fiber Bundles for Data", "likes": 108, "published": True},
            {"id": 3, "author": "jpark", "title": "Draft: Part 3", "likes": 0, "published": False},
        ]
    },
}

# ───────────────────────────────────────────────────────────────────────────
# Format representations
# ───────────────────────────────────────────────────────────────────────────

JSON_REPR = {name: json.dumps(data, separators=(",", ":")) for name, data in DATASETS.items()}

TOON_REPR = {
    "Customer Reviews": (
        "reviews[3]{id, customer, rating, comment, verified}:\n"
        "  101, Alex Rivera, 5, Excellent!, true\n"
        "  102, Brij Pandey, 5, Game changer!, true\n"
        "  103, Casey Lee, 3, Average, false"
    ),
    "Sensor Readings": (
        "readings[3]{sensor_id, timestamp, value, status, unit}:\n"
        "  T-001, 1710000000, 22.4, normal, celsius\n"
        "  T-002, 1710000060, 23.1, normal, celsius\n"
        "  T-003, 1710000120, 45.8, alert, celsius"
    ),
    "User Profiles": (
        "users[3]{id, name, email, role, active}:\n"
        "  201, Dana Kim, dana@example.com, admin, true\n"
        "  202, Eli Rosenberg, eli@example.com, editor, true\n"
        "  203, Farah Nassar, farah@example.com, viewer, true"
    ),
    "Nested Order": (
        "order[1]{id, customer, total, items, shipping}:\n"
        "  ORD-7891, Diana Prince, 149.99, "
        "[{sku, name, qty, price}: A100, Widget, 2, 49.99; A101, Gadget, 1, 50.01], "
        "[{method, address}: express, 1234 Elm St]"
    ),
    "API Response": (
        "posts[3]{id, author, title, likes, published}:\n"
        "  1, jpark, Intro to DHOOM, 42, true\n"
        "  2, beedavis, Fiber Bundles for Data, 108, true\n"
        "  3, jpark, Draft: Part 3, 0, false"
    ),
}

DHOOM_REPR = {
    "Customer Reviews": (
        "reviews{id@101, customer, comment, rating|5, verified|T}:\n"
        "Alex Rivera, Excellent!\n"
        "Brij Pandey, Game changer!\n"
        "Casey Lee, Average, :3, :F"
    ),
    "Sensor Readings": (
        "readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:\n"
        "22.4\n"
        "23.1\n"
        "45.8, :alert"
    ),
    "User Profiles": (
        "users{id@201, name, email, role, active|T}:\n"
        "Dana Kim, dana@example.com, admin\n"
        "Eli Rosenberg, eli@example.com, editor\n"
        "Farah Nassar, farah@example.com, viewer"
    ),
    "Nested Order": (
        "order{id, customer, total, items>, shipping>}:\n"
        "ORD-7891, Diana Prince, 149.99,\n"
        "  {sku@A100, name, qty, price}:\n"
        "  Widget, 2, 49.99\n"
        "  Gadget, 1, 50.01,\n"
        "  {method, address}:\n"
        "  express, 1234 Elm St"
    ),
    "API Response": (
        "posts{id@1, author, title, likes, published|T}:\n"
        "jpark, Intro to DHOOM, 42\n"
        "beedavis, Fiber Bundles for Data, 108\n"
        "jpark, Draft: Part 3, :0, :F"
    ),
}

FORMAT_DATA = {"JSON": JSON_REPR, "TOON": TOON_REPR, "DHOOM": DHOOM_REPR}

# ───────────────────────────────────────────────────────────────────────────
# 209 Questions — (dataset, category, question, [acceptable_answers])
#
# Categories:
#   DL = Direct Lookup     RL = Reverse Lookup   CF = Cross-field
#   CT = Count             LS = List             AG = Aggregate
#   EX = Existence         FT = Filter           BC = Boolean Check
#   NS = Nested
# ───────────────────────────────────────────────────────────────────────────

QUESTIONS = [
    # ── Customer Reviews (42) ─────────────────────────────────────────────
    ("Customer Reviews", "DL", "What is the id of customer Alex Rivera's review?", ["101"]),
    ("Customer Reviews", "DL", "What rating did Alex Rivera give?", ["5"]),
    ("Customer Reviews", "DL", "What comment did Alex Rivera leave?", ["Excellent!", "Excellent"]),
    ("Customer Reviews", "DL", "What is the id of customer Brij Pandey's review?", ["102"]),
    ("Customer Reviews", "DL", "What rating did Brij Pandey give?", ["5"]),
    ("Customer Reviews", "DL", "What comment did Brij Pandey leave?", ["Game changer!", "Game changer"]),
    ("Customer Reviews", "DL", "What is the id of customer Casey Lee's review?", ["103"]),
    ("Customer Reviews", "DL", "What rating did Casey Lee give?", ["3"]),
    ("Customer Reviews", "DL", "What comment did Casey Lee leave?", ["Average"]),
    ("Customer Reviews", "BC", "Is Alex Rivera's review verified?", ["true", "yes"]),
    ("Customer Reviews", "BC", "Is Brij Pandey's review verified?", ["true", "yes"]),
    ("Customer Reviews", "BC", "Is Casey Lee's review verified?", ["false", "no"]),
    ("Customer Reviews", "RL", "Which customer has review id 101?", ["Alex Rivera"]),
    ("Customer Reviews", "RL", "Which customer has review id 102?", ["Brij Pandey"]),
    ("Customer Reviews", "RL", "Which customer has review id 103?", ["Casey Lee"]),
    ("Customer Reviews", "RL", "Which customer left the comment 'Game changer!'?", ["Brij Pandey"]),
    ("Customer Reviews", "RL", "Which customer has a rating of 3?", ["Casey Lee"]),
    ("Customer Reviews", "CF", "What is the comment for the review with id 102?", ["Game changer!", "Game changer"]),
    ("Customer Reviews", "CF", "What is the verification status of the review with rating 3?", ["false", "not verified", "unverified", "no"]),
    ("Customer Reviews", "CF", "What is the customer name for the review with id 101?", ["Alex Rivera"]),
    ("Customer Reviews", "CF", "What is the id of the unverified review?", ["103"]),
    ("Customer Reviews", "CF", "What rating did the customer who commented 'Average' give?", ["3"]),
    ("Customer Reviews", "CT", "How many reviews have a rating of 5?", ["2"]),
    ("Customer Reviews", "CT", "How many reviews are verified?", ["2"]),
    ("Customer Reviews", "CT", "How many reviews are not verified?", ["1"]),
    ("Customer Reviews", "CT", "How many total reviews are there?", ["3"]),
    ("Customer Reviews", "CT", "How many reviews have a rating above 3?", ["2"]),
    ("Customer Reviews", "LS", "List all customer names, comma-separated.", ["Alex Rivera, Brij Pandey, Casey Lee"]),
    ("Customer Reviews", "LS", "List all review ids, comma-separated.", ["101, 102, 103"]),
    ("Customer Reviews", "LS", "List all ratings, comma-separated.", ["5, 5, 3"]),
    ("Customer Reviews", "LS", "List all comments, comma-separated.", ["Excellent!, Game changer!, Average"]),
    ("Customer Reviews", "AG", "What is the highest rating?", ["5"]),
    ("Customer Reviews", "AG", "What is the lowest rating?", ["3"]),
    ("Customer Reviews", "AG", "What is the sum of all review ids?", ["306"]),
    ("Customer Reviews", "EX", "Is there a review with a rating of 1?", ["false", "no"]),
    ("Customer Reviews", "EX", "Is there a verified review with rating 5?", ["true", "yes"]),
    ("Customer Reviews", "EX", "Is there a review from a customer named 'Dana Kim'?", ["false", "no"]),
    ("Customer Reviews", "FT", "Which customers gave a rating of 5? List comma-separated.", ["Alex Rivera, Brij Pandey"]),
    ("Customer Reviews", "FT", "Which review ids are verified? List comma-separated.", ["101, 102"]),
    ("Customer Reviews", "FT", "Which customers are not verified? List comma-separated.", ["Casey Lee"]),
    ("Customer Reviews", "BC", "Is review id 101 verified?", ["true", "yes"]),
    ("Customer Reviews", "BC", "Is review id 103 verified?", ["false", "no"]),

    # ── Sensor Readings (42) ──────────────────────────────────────────────
    ("Sensor Readings", "DL", "What is the sensor_id of the first reading?", ["T-001"]),
    ("Sensor Readings", "DL", "What is the timestamp of sensor T-001?", ["1710000000"]),
    ("Sensor Readings", "DL", "What is the value of sensor T-001?", ["22.4"]),
    ("Sensor Readings", "DL", "What is the status of sensor T-001?", ["normal"]),
    ("Sensor Readings", "DL", "What is the unit of sensor T-001?", ["celsius"]),
    ("Sensor Readings", "DL", "What is the timestamp of sensor T-002?", ["1710000060"]),
    ("Sensor Readings", "DL", "What is the value of sensor T-002?", ["23.1"]),
    ("Sensor Readings", "DL", "What is the status of sensor T-002?", ["normal"]),
    ("Sensor Readings", "DL", "What is the unit of sensor T-002?", ["celsius"]),
    ("Sensor Readings", "DL", "What is the timestamp of sensor T-003?", ["1710000120"]),
    ("Sensor Readings", "DL", "What is the value of sensor T-003?", ["45.8"]),
    ("Sensor Readings", "DL", "What is the status of sensor T-003?", ["alert"]),
    ("Sensor Readings", "RL", "Which sensor has value 22.4?", ["T-001"]),
    ("Sensor Readings", "RL", "Which sensor has value 45.8?", ["T-003"]),
    ("Sensor Readings", "RL", "Which sensor has status 'alert'?", ["T-003"]),
    ("Sensor Readings", "RL", "Which sensor has timestamp 1710000060?", ["T-002"]),
    ("Sensor Readings", "CF", "What is the value for the sensor with status 'alert'?", ["45.8"]),
    ("Sensor Readings", "CF", "What is the status of the sensor with value 23.1?", ["normal"]),
    ("Sensor Readings", "CF", "What is the sensor_id with the highest value?", ["T-003"]),
    ("Sensor Readings", "CF", "What is the timestamp of the sensor with value 22.4?", ["1710000000"]),
    ("Sensor Readings", "CF", "What unit does sensor T-003 use?", ["celsius"]),
    ("Sensor Readings", "CT", "How many sensors have status 'normal'?", ["2"]),
    ("Sensor Readings", "CT", "How many sensors have status 'alert'?", ["1"]),
    ("Sensor Readings", "CT", "How many total readings are there?", ["3"]),
    ("Sensor Readings", "CT", "How many sensors have value above 30?", ["1"]),
    ("Sensor Readings", "CT", "How many sensors use celsius as unit?", ["3"]),
    ("Sensor Readings", "LS", "List all sensor ids, comma-separated.", ["T-001, T-002, T-003"]),
    ("Sensor Readings", "LS", "List all sensor values, comma-separated.", ["22.4, 23.1, 45.8"]),
    ("Sensor Readings", "LS", "List all sensor statuses, comma-separated.", ["normal, normal, alert"]),
    ("Sensor Readings", "LS", "List all timestamps, comma-separated.", ["1710000000, 1710000060, 1710000120"]),
    ("Sensor Readings", "AG", "What is the highest sensor value?", ["45.8"]),
    ("Sensor Readings", "AG", "What is the lowest sensor value?", ["22.4"]),
    ("Sensor Readings", "AG", "What is the earliest timestamp?", ["1710000000"]),
    ("Sensor Readings", "AG", "What is the latest timestamp?", ["1710000120"]),
    ("Sensor Readings", "EX", "Is there a sensor with value above 40?", ["true", "yes"]),
    ("Sensor Readings", "EX", "Is there a sensor with status 'warning'?", ["false", "no"]),
    ("Sensor Readings", "EX", "Is there a sensor with id 'T-004'?", ["false", "no"]),
    ("Sensor Readings", "FT", "Which sensors have status 'normal'? List comma-separated.", ["T-001, T-002"]),
    ("Sensor Readings", "FT", "Which sensors have value below 25? List comma-separated.", ["T-001, T-002"]),
    ("Sensor Readings", "FT", "Which sensor ids have value above 30? List comma-separated.", ["T-003"]),
    ("Sensor Readings", "BC", "Does sensor T-001 have status 'normal'?", ["true", "yes"]),
    ("Sensor Readings", "BC", "Does sensor T-003 have status 'normal'?", ["false", "no"]),

    # ── User Profiles (42) ────────────────────────────────────────────────
    ("User Profiles", "DL", "What is Dana Kim's user id?", ["201"]),
    ("User Profiles", "DL", "What is Dana Kim's email?", ["dana@example.com"]),
    ("User Profiles", "DL", "What is Dana Kim's role?", ["admin"]),
    ("User Profiles", "BC", "Is Dana Kim active?", ["true", "yes"]),
    ("User Profiles", "DL", "What is Eli Rosenberg's user id?", ["202"]),
    ("User Profiles", "DL", "What is Eli Rosenberg's email?", ["eli@example.com"]),
    ("User Profiles", "DL", "What is Eli Rosenberg's role?", ["editor"]),
    ("User Profiles", "BC", "Is Eli Rosenberg active?", ["true", "yes"]),
    ("User Profiles", "DL", "What is Farah Nassar's user id?", ["203"]),
    ("User Profiles", "DL", "What is Farah Nassar's email?", ["farah@example.com"]),
    ("User Profiles", "DL", "What is Farah Nassar's role?", ["viewer"]),
    ("User Profiles", "BC", "Is Farah Nassar active?", ["true", "yes"]),
    ("User Profiles", "RL", "Which user has id 201?", ["Dana Kim"]),
    ("User Profiles", "RL", "Which user has id 202?", ["Eli Rosenberg"]),
    ("User Profiles", "RL", "Which user has id 203?", ["Farah Nassar"]),
    ("User Profiles", "RL", "Which user has role 'admin'?", ["Dana Kim"]),
    ("User Profiles", "RL", "Which user has email 'eli@example.com'?", ["Eli Rosenberg"]),
    ("User Profiles", "CF", "What is the role of user with id 201?", ["admin"]),
    ("User Profiles", "CF", "What is the email of the admin user?", ["dana@example.com"]),
    ("User Profiles", "CF", "What is the id of the viewer?", ["203"]),
    ("User Profiles", "CF", "What is the name of user with email 'farah@example.com'?", ["Farah Nassar"]),
    ("User Profiles", "CF", "What is the role of user with id 202?", ["editor"]),
    ("User Profiles", "CT", "How many users are active?", ["3"]),
    ("User Profiles", "CT", "How many users have role 'admin'?", ["1"]),
    ("User Profiles", "CT", "How many users have role 'editor'?", ["1"]),
    ("User Profiles", "CT", "How many users have role 'viewer'?", ["1"]),
    ("User Profiles", "CT", "How many total users are there?", ["3"]),
    ("User Profiles", "LS", "List all user names, comma-separated.", ["Dana Kim, Eli Rosenberg, Farah Nassar"]),
    ("User Profiles", "LS", "List all user ids, comma-separated.", ["201, 202, 203"]),
    ("User Profiles", "LS", "List all user roles, comma-separated.", ["admin, editor, viewer"]),
    ("User Profiles", "LS", "List all user emails, comma-separated.", ["dana@example.com, eli@example.com, farah@example.com"]),
    ("User Profiles", "AG", "What is the lowest user id?", ["201"]),
    ("User Profiles", "AG", "What is the highest user id?", ["203"]),
    ("User Profiles", "AG", "What is the sum of all user ids?", ["606"]),
    ("User Profiles", "EX", "Is there a user with role 'moderator'?", ["false", "no"]),
    ("User Profiles", "EX", "Is there an inactive user?", ["false", "no"]),
    ("User Profiles", "EX", "Is there a user with email domain 'example.com'?", ["true", "yes"]),
    ("User Profiles", "FT", "Which users are active? List comma-separated.", ["Dana Kim, Eli Rosenberg, Farah Nassar"]),
    ("User Profiles", "FT", "Which user has role 'admin'?", ["Dana Kim"]),
    ("User Profiles", "FT", "Which users have id greater than 201? List comma-separated.", ["Eli Rosenberg, Farah Nassar"]),
    ("User Profiles", "BC", "Is user id 201 active?", ["true", "yes"]),
    ("User Profiles", "BC", "Does Farah Nassar have role 'admin'?", ["false", "no"]),

    # ── Nested Order (42) ─────────────────────────────────────────────────
    ("Nested Order", "DL", "What is the order id?", ["ORD-7891"]),
    ("Nested Order", "DL", "Who is the customer for the order?", ["Diana Prince"]),
    ("Nested Order", "DL", "What is the order total?", ["149.99"]),
    ("Nested Order", "DL", "What is the shipping method?", ["express"]),
    ("Nested Order", "DL", "What is the shipping address?", ["1234 Elm St"]),
    ("Nested Order", "NS", "What is the sku of the first item?", ["A100"]),
    ("Nested Order", "NS", "What is the name of the first item?", ["Widget"]),
    ("Nested Order", "NS", "What is the qty of the first item?", ["2"]),
    ("Nested Order", "NS", "What is the price of the first item?", ["49.99"]),
    ("Nested Order", "NS", "What is the sku of the second item?", ["A101"]),
    ("Nested Order", "NS", "What is the name of the second item?", ["Gadget"]),
    ("Nested Order", "NS", "What is the qty of the second item?", ["1"]),
    ("Nested Order", "NS", "What is the price of the second item?", ["50.01"]),
    ("Nested Order", "CF", "What is the sku of the item named 'Widget'?", ["A100"]),
    ("Nested Order", "CF", "What is the sku of the item named 'Gadget'?", ["A101"]),
    ("Nested Order", "CF", "What is the price of the item with sku A100?", ["49.99"]),
    ("Nested Order", "CF", "What is the price of the item with sku A101?", ["50.01"]),
    ("Nested Order", "CF", "What is the qty of the item with sku A100?", ["2"]),
    ("Nested Order", "CF", "What is the qty of the item with sku A101?", ["1"]),
    ("Nested Order", "CF", "What is the name of the item with price 49.99?", ["Widget"]),
    ("Nested Order", "CF", "What is the name of the item with price 50.01?", ["Gadget"]),
    ("Nested Order", "CT", "How many items are in the order?", ["2"]),
    ("Nested Order", "CT", "How many shipping entries are there?", ["1"]),
    ("Nested Order", "CT", "How many items have qty greater than 1?", ["1"]),
    ("Nested Order", "CT", "How many items have price above 50?", ["1"]),
    ("Nested Order", "AG", "What is the total quantity of all items (sum of qty)?", ["3"]),
    ("Nested Order", "AG", "What is the highest item price?", ["50.01"]),
    ("Nested Order", "AG", "What is the lowest item price?", ["49.99"]),
    ("Nested Order", "LS", "List all item names, comma-separated.", ["Widget, Gadget"]),
    ("Nested Order", "LS", "List all item skus, comma-separated.", ["A100, A101"]),
    ("Nested Order", "LS", "List all item prices, comma-separated.", ["49.99, 50.01"]),
    ("Nested Order", "LS", "List all item quantities, comma-separated.", ["2, 1"]),
    ("Nested Order", "EX", "Is there an item with sku 'A102'?", ["false", "no"]),
    ("Nested Order", "EX", "Is there an item named 'Widget'?", ["true", "yes"]),
    ("Nested Order", "EX", "Is there a shipping method 'standard'?", ["false", "no"]),
    ("Nested Order", "EX", "Does the order contain a 'Gadget'?", ["true", "yes"]),
    ("Nested Order", "FT", "Which items have qty greater than 1? List names.", ["Widget"]),
    ("Nested Order", "FT", "Which items have price below 50? List names.", ["Widget"]),
    ("Nested Order", "BC", "Is the shipping method 'express'?", ["true", "yes"]),
    ("Nested Order", "BC", "Is the order total above 100?", ["true", "yes"]),
    ("Nested Order", "BC", "Does item A100 have qty of 2?", ["true", "yes"]),
    ("Nested Order", "BC", "Is the customer 'Diana Prince'?", ["true", "yes"]),

    # ── API Response (41) ─────────────────────────────────────────────────
    ("API Response", "DL", "Who is the author of post 1?", ["jpark"]),
    ("API Response", "DL", "What is the title of post 1?", ["Intro to DHOOM"]),
    ("API Response", "DL", "How many likes does post 1 have?", ["42"]),
    ("API Response", "BC", "Is post 1 published?", ["true", "yes"]),
    ("API Response", "DL", "Who is the author of post 2?", ["beedavis"]),
    ("API Response", "DL", "What is the title of post 2?", ["Fiber Bundles for Data"]),
    ("API Response", "DL", "How many likes does post 2 have?", ["108"]),
    ("API Response", "BC", "Is post 2 published?", ["true", "yes"]),
    ("API Response", "DL", "Who is the author of post 3?", ["jpark"]),
    ("API Response", "DL", "What is the title of post 3?", ["Draft: Part 3"]),
    ("API Response", "DL", "How many likes does post 3 have?", ["0"]),
    ("API Response", "BC", "Is post 3 published?", ["false", "no"]),
    ("API Response", "RL", "What is the id of the post titled 'Intro to DHOOM'?", ["1"]),
    ("API Response", "RL", "What is the id of the post with 108 likes?", ["2"]),
    ("API Response", "RL", "What is the id of the post with 0 likes?", ["3"]),
    ("API Response", "RL", "What is the id of the post by 'beedavis'?", ["2"]),
    ("API Response", "CF", "What is the title of the post by beedavis?", ["Fiber Bundles for Data"]),
    ("API Response", "CF", "How many likes does the post titled 'Draft: Part 3' have?", ["0"]),
    ("API Response", "CF", "Is the post by beedavis published?", ["true", "yes"]),
    ("API Response", "CF", "What is the author of the post with the most likes?", ["beedavis"]),
    ("API Response", "CF", "What is the title of the most liked post?", ["Fiber Bundles for Data"]),
    ("API Response", "CT", "How many posts are published?", ["2"]),
    ("API Response", "CT", "How many posts are not published?", ["1"]),
    ("API Response", "CT", "How many posts does jpark have?", ["2"]),
    ("API Response", "CT", "How many total posts are there?", ["3"]),
    ("API Response", "LS", "List all post titles, comma-separated.", ["Intro to DHOOM, Fiber Bundles for Data, Draft: Part 3"]),
    ("API Response", "LS", "List all post authors, comma-separated.", ["jpark, beedavis, jpark"]),
    ("API Response", "LS", "List all post ids, comma-separated.", ["1, 2, 3"]),
    ("API Response", "LS", "List all like counts, comma-separated.", ["42, 108, 0"]),
    ("API Response", "AG", "What is the total number of likes across all posts?", ["150"]),
    ("API Response", "AG", "What is the highest number of likes?", ["108"]),
    ("API Response", "AG", "What is the lowest number of likes?", ["0"]),
    ("API Response", "EX", "Is there a post by author 'admin'?", ["false", "no"]),
    ("API Response", "EX", "Is there a published post with 0 likes?", ["false", "no"]),
    ("API Response", "EX", "Is there a post with more than 100 likes?", ["true", "yes"]),
    ("API Response", "FT", "Which post ids are published? List comma-separated.", ["1, 2"]),
    ("API Response", "FT", "Which authors have published posts? List comma-separated.", ["jpark, beedavis"]),
    ("API Response", "FT", "Which post ids have more than 10 likes? List comma-separated.", ["1, 2"]),
    ("API Response", "BC", "Is post id 3 published?", ["false", "no"]),
    ("API Response", "BC", "Does post id 1 have more than 40 likes?", ["true", "yes"]),
    ("API Response", "BC", "Is the post 'Draft: Part 3' published?", ["false", "no"]),
]

assert len(QUESTIONS) == 209, f"Expected 209 questions, got {len(QUESTIONS)}"

# ───────────────────────────────────────────────────────────────────────────
# Answer matching
# ───────────────────────────────────────────────────────────────────────────

_BOOL_TRUE = {"true", "yes", "t", "y"}
_BOOL_FALSE = {"false", "no", "f", "n"}


def _normalize(s: str) -> str:
    s = s.strip().lower()
    s = s.rstrip(".")
    s = s.strip("\"'`")
    for prefix in ("the answer is ", "answer: ", "the value is ", "result: "):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s.strip()


def _numeric_eq(a: str, b: str) -> bool:
    try:
        return abs(float(a) - float(b)) < 0.01
    except (ValueError, OverflowError):
        return False


def _sorted_list(s: str) -> list[str]:
    return sorted(x.strip() for x in s.split(",") if x.strip())


def answers_match(got: str, expected_list: list[str]) -> bool:
    got_n = _normalize(got)
    for exp in expected_list:
        exp_n = _normalize(exp)
        # Exact
        if got_n == exp_n:
            return True
        # Boolean equivalence
        if got_n in _BOOL_TRUE and exp_n in _BOOL_TRUE:
            return True
        if got_n in _BOOL_FALSE and exp_n in _BOOL_FALSE:
            return True
        # Numeric
        if _numeric_eq(got_n, exp_n):
            return True
        # Sorted list
        if "," in exp_n and _sorted_list(got_n) == _sorted_list(exp_n):
            return True
        # Containment fallback (LLM wraps answer in sentence)
        if len(exp_n) > 2 and exp_n in got_n:
            return True
    return False


# ───────────────────────────────────────────────────────────────────────────
# LLM clients
# ───────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a precise data extraction assistant. Rules:\n"
    "- Answer with ONLY the exact value(s) requested\n"
    "- For yes/no or true/false questions, answer \"true\" or \"false\"\n"
    "- For lists, separate items with \", \" (comma space)\n"
    "- No explanations, no extra text"
)

DHOOM_FORMAT_GUIDE = (
    "DHOOM (Davis Human-readable Optimized Object Markup) decoding rules:\n\n"
    "STRUCTURE: The first line is the HEADER → name{field1, field2, ...}:\n"
    "Each subsequent non-blank line is exactly ONE RECORD.\n"
    "Count the data lines (non-blank, non-header) to know how many records exist.\n\n"
    "HEADER MODIFIERS:\n"
    "  field@N     — Arithmetic: auto-sequence starting at N, +1 per record.\n"
    "                This field is NOT in record lines; compute it by position.\n"
    "                Record 1 → N, Record 2 → N+1, Record 3 → N+2, etc.\n"
    "  field@N+S   — Arithmetic with custom step S.\n"
    "                Record 1 → N, Record 2 → N+S, Record 3 → N+2S, etc.\n"
    "  field@PFX   — String prefix with auto-incrementing numeric suffix.\n"
    "                Example: 3 records with sid@T-001 → sid=T-001, sid=T-002, sid=T-003\n"
    "  field|V     — Default (modal) value V for every record unless overridden.\n"
    "                Override in a specific record by writing :NEWVAL in that position.\n"
    "                T means true, F means false.\n"
    "  field>      — Nested sub-bundle: an indented DHOOM block follows in the record.\n\n"
    "IMPORTANT: The @ modifier ONLY applies to the specific field it is declared on \n"
    "in THAT specific header. It does NOT mean values in record body rows follow an \n"
    "arithmetic pattern. Values that appear in record body rows are ALWAYS literal \n"
    "values — read them exactly as written. Only fields with @ in the HEADER are \n"
    "arithmetic. Everything in the BODY is a literal value.\n\n"
    "DEVIATION MARKER ':' (CRITICAL — read carefully):\n"
    "When a record overrides a default field, the override value is prefixed with ':'.\n"
    "  :alert  → actual value is 'alert', NOT the default\n"
    "  :F      → actual value is false, NOT the default true\n"
    "  :3      → actual value is 3, NOT the default\n"
    "The value AFTER the colon replaces the default entirely.\n"
    "Before answering any question about a field with a default, CHECK the specific\n"
    "record for a ':' deviation marker. If present, the record's value is the text\n"
    "after ':', not the header default.\n\n"
    "RECORD LINES: comma-separated values for NON-arithmetic fields only,\n"
    "in the same left-to-right order as the header (skipping @ fields).\n"
    "Trailing default values may be omitted (trailing elision).\n\n"
    "FLAT EXAMPLE:\n"
    "  items{id@101, name, price, in_stock|T}:\n"
    "  Widget, 9.99\n"
    "  Gadget, 14.50, :F\n"
    "  Gizmo, 5.00\n"
    "Decoding step by step:\n"
    "  Record 1 (line 1): id=101 (@ start), name=Widget, price=9.99, in_stock=true (default)\n"
    "  Record 2 (line 2): id=102 (@ +1),    name=Gadget, price=14.50, in_stock=false (:F overrides)\n"
    "  Record 3 (line 3): id=103 (@ +2),    name=Gizmo,  price=5.00,  in_stock=true (default)\n\n"
    "NESTED BUNDLE EXAMPLE:\n"
    "  order{id, customer, items>}:\n"
    "  ORD-1, Alice,\n"
    "    {sku@B200, name, price}:\n"
    "    Widget, 9.99\n"
    "    Gadget, 14.50\n"
    "Expanded (2 items under the nested header):\n"
    "  order.id = \"ORD-1\"\n"
    "  order.customer = \"Alice\"\n"
    "  order.items[0] = {sku: \"B200\", name: \"Widget\", price: 9.99}  ← sku@B200: 1st record = B200\n"
    "  order.items[1] = {sku: \"B201\", name: \"Gadget\", price: 14.50} ← sku@B200: 2nd record = B201\n"
    "The @ sequence increments by 1 per record WITHIN the nested bundle.\n"
    "2 records → B200, B201 (NOT B200, B202).\n"
    "The @ sequence produces EXACTLY as many values as there are data lines.\n"
    "If there are 2 records, @ produces only 2 values. There is no 3rd value.\n"
)

FORMAT_LABELS = {
    "JSON": "JSON",
    "TOON": "TOON (Tab-delimited Object Notation)",
    "DHOOM": "DHOOM",
}


def _build_prompt(fmt: str, data: str, question: str) -> str:
    label = FORMAT_LABELS[fmt]
    return f"The following data is in {label} format:\n\n{data}\n\nQuestion: {question}"


def ask_claude(prompt: str, model: str, fmt: str = "JSON", max_retries: int = 5) -> str:
    if anthropic is None:
        return "ERROR: anthropic package not installed"
    client = anthropic.Anthropic()
    sys_prompt = SYSTEM_PROMPT
    if fmt == "DHOOM":
        sys_prompt = DHOOM_FORMAT_GUIDE + "\n" + SYSTEM_PROMPT
    for attempt in range(max_retries):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=150,
                temperature=0,
                system=sys_prompt,
                messages=[{"role": "user", "content": prompt}],
            )
            return resp.content[0].text.strip()
        except anthropic.RateLimitError:
            wait = min(2 ** (attempt + 1), 30)
            print(f"    ⏳ rate-limited, waiting {wait}s...")
            time.sleep(wait)
        except anthropic.APIStatusError as e:
            if e.status_code == 529:  # overloaded
                wait = min(2 ** (attempt + 1), 30)
                print(f"    ⏳ API overloaded, waiting {wait}s...")
                time.sleep(wait)
            else:
                return f"ERROR: {e.status_code} {e.message}"
        except Exception as e:
            return f"ERROR: {e}"
    return "ERROR: max retries exceeded"


def ask_openai(prompt: str, model: str, fmt: str = "JSON", max_retries: int = 5) -> str:
    if openai_mod is None:
        return "ERROR: openai package not installed"
    client = openai_mod.OpenAI()
    sys_prompt = SYSTEM_PROMPT
    if fmt == "DHOOM":
        sys_prompt = DHOOM_FORMAT_GUIDE + "\n" + SYSTEM_PROMPT
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                max_tokens=150,
                temperature=0,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": prompt},
                ],
            )
            return resp.choices[0].message.content.strip()
        except openai_mod.RateLimitError:
            wait = min(2 ** (attempt + 1), 30)
            print(f"    \u23f3 rate-limited, waiting {wait}s...")
            time.sleep(wait)
        except openai_mod.APIStatusError as e:
            if e.status_code in (429, 529):
                wait = min(2 ** (attempt + 1), 30)
                print(f"    \u23f3 API overloaded, waiting {wait}s...")
                time.sleep(wait)
            else:
                return f"ERROR: {e.status_code} {e.message}"
        except Exception as e:
            return f"ERROR: {e}"
    return "ERROR: max retries exceeded"


def ask_llm(prompt: str, model: str, fmt: str = "JSON") -> str:
    """Route to the right provider based on model name."""
    if model.startswith("gpt-") or model.startswith("o1") or model.startswith("o3") or model.startswith("o4"):
        return ask_openai(prompt, model, fmt)
    else:
        return ask_claude(prompt, model, fmt)


# ───────────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────────

CATEGORY_NAMES = {
    "DL": "Direct Lookup",
    "RL": "Reverse Lookup",
    "CF": "Cross-field",
    "CT": "Count",
    "LS": "List",
    "AG": "Aggregate",
    "EX": "Existence",
    "FT": "Filter",
    "BC": "Boolean",
    "NS": "Nested",
}


def main():
    parser = argparse.ArgumentParser(description="DHOOM LLM Accuracy Benchmark")
    parser.add_argument("--dry-run", action="store_true", help="List questions without calling API")
    parser.add_argument("--model", default="claude-sonnet-4-20250514", help="Model to use")
    parser.add_argument("--format", choices=["JSON", "TOON", "DHOOM"], help="Test only one format")
    parser.add_argument("--dataset", help="Test only one dataset")
    parser.add_argument("--delay", type=float, default=0.3, help="Delay between API calls (seconds)")
    parser.add_argument("--output", help="Save results to JSON file")
    parser.add_argument("--retry", help="Re-run only failures from a previous results JSON file")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first failure")
    args = parser.parse_args()

    formats = [args.format] if args.format else ["JSON", "TOON", "DHOOM"]
    questions = QUESTIONS
    if args.dataset:
        questions = [q for q in questions if q[0] == args.dataset]
        if not questions:
            print(f"No questions for dataset '{args.dataset}'")
            print(f"Available: {', '.join(sorted(set(q[0] for q in QUESTIONS)))}")
            sys.exit(1)

    # --retry mode: reload previous results, keep passes, re-run failures + missing
    prev_results = []
    passed_keys = set()  # (format, question) pairs that already passed
    if args.retry:
        prev_path = Path(args.retry)
        if not prev_path.exists():
            print(f"ERROR: retry file not found: {prev_path}")
            sys.exit(1)
        prev_results = json.loads(prev_path.read_text())
        for r in prev_results:
            if r["correct"]:
                passed_keys.add((r["format"], r["question"]))
        n_fail = sum(1 for r in prev_results if not r["correct"])
        # Count questions in target formats that were never attempted
        all_q_keys = set()
        for fmt in formats:
            for ds, cat, q, exp in questions:
                all_q_keys.add((fmt, q))
        n_missing = len(all_q_keys - passed_keys - set((r["format"], r["question"]) for r in prev_results))
        print(f"Retry mode: {len(passed_keys)} passed (kept), {n_fail} failed + {n_missing} never-run to re-run")

    print("=" * 80)
    print("DHOOM LLM Accuracy Benchmark — 209-question methodology")
    print(f"Model: {args.model}")
    print(f"Formats: {', '.join(formats)}")
    print(f"Questions: {len(questions)}")
    print("=" * 80)

    if args.dry_run:
        for i, (ds, cat, q, ans) in enumerate(questions, 1):
            print(f"  [{i:>3}] [{cat}] ({ds}) {q}")
            print(f"        Expected: {ans}")
        print(f"\nTotal: {len(questions)} questions × {len(formats)} formats = {len(questions) * len(formats)} API calls")
        return

    # Check API key
    is_openai = args.model.startswith("gpt-") or args.model.startswith("o1") or args.model.startswith("o3") or args.model.startswith("o4")
    if is_openai:
        if not os.environ.get("OPENAI_API_KEY"):
            print("ERROR: OPENAI_API_KEY not set. Add it to .env or export it.")
            sys.exit(1)
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("ERROR: ANTHROPIC_API_KEY not set. Add it to .env or export it.")
            sys.exit(1)

    # Run benchmark
    results = {}  # {format: {dataset: [(q, cat, expected, got, correct)]}}
    all_results_flat = []

    # In retry mode, seed all_results_flat with previous passes
    if args.retry and prev_results:
        for r in prev_results:
            if r["correct"]:
                all_results_flat.append(r)

    # Auto-save path (incremental, survives crashes)
    save_path = Path(args.output) if args.output else Path("benchmarks/llm-results.json")

    def _save_incremental():
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(json.dumps(all_results_flat, indent=2))

    for fmt in formats:
        print(f"\n{'─' * 80}")
        print(f"  Format: {fmt}")
        print(f"{'─' * 80}")
        results[fmt] = {}
        correct_total = 0
        skipped = 0

        for i, (ds, cat, question, expected) in enumerate(questions, 1):
            # In retry mode, skip questions that already passed
            if passed_keys and (fmt, question) in passed_keys:
                # Still count it for accuracy
                ok = True
                got = next((r["got"] for r in prev_results
                           if r["format"] == fmt and r["question"] == question), "")
                correct_total += 1
                skipped += 1
                results[fmt].setdefault(ds, []).append((question, cat, expected, got, ok))
                continue

            data = FORMAT_DATA[fmt][ds]
            prompt = _build_prompt(fmt, data, question)
            got = ask_llm(prompt, args.model, fmt=fmt)
            ok = answers_match(got, expected)
            correct_total += int(ok)

            mark = "✓" if ok else "✗"
            print(f"  [{i:>3}/{len(questions)}] {mark} [{cat}] {question}")
            if not ok:
                print(f"           Expected: {expected[0]}  Got: {got}")

            results[fmt].setdefault(ds, []).append((question, cat, expected, got, ok))
            all_results_flat.append({
                "format": fmt, "dataset": ds, "category": cat,
                "question": question, "expected": expected,
                "got": got, "correct": ok,
            })

            # Auto-save after every question (crash-safe)
            _save_incremental()

            if not ok and args.fail_fast:
                print("\n  ❌ --fail-fast: stopping on first failure")
                _save_incremental()
                sys.exit(1)

            if args.delay > 0 and i < len(questions):
                time.sleep(args.delay)

        n_run = len(questions) - skipped
        acc = correct_total / len(questions) * 100
        if skipped:
            print(f"\n  {fmt}: {correct_total}/{len(questions)} ({acc:.1f}%) — {skipped} skipped (prev pass), {n_run} re-run")
        else:
            print(f"\n  {fmt} accuracy: {correct_total}/{len(questions)} ({acc:.1f}%)")

    # ── Summary tables ────────────────────────────────────────────────────
    print(f"\n{'=' * 80}")
    print("RESULTS SUMMARY")
    print(f"{'=' * 80}")

    # Overall accuracy
    print(f"\n### Overall Accuracy\n")
    print(f"{'Format':<10} {'Correct':>8} {'Total':>6} {'Accuracy':>9}")
    print("-" * 36)
    for fmt in formats:
        total = sum(len(v) for v in results[fmt].values())
        correct = sum(sum(1 for *_, ok in v if ok) for v in results[fmt].values())
        print(f"{fmt:<10} {correct:>8} {total:>6} {correct / total * 100:>8.1f}%")

    # By dataset
    print(f"\n### Accuracy by Dataset\n")
    ds_names = sorted(set(q[0] for q in questions))
    header = f"{'Dataset':<22}" + "".join(f" {f:>8}" for f in formats)
    print(header)
    print("-" * len(header))
    for ds in ds_names:
        row = f"{ds:<22}"
        for fmt in formats:
            qs = results[fmt].get(ds, [])
            if qs:
                c = sum(1 for *_, ok in qs if ok)
                row += f" {c}/{len(qs):>5}"
            else:
                row += "      n/a"
        print(row)

    # By category
    print(f"\n### Accuracy by Category\n")
    cats = sorted(set(q[1] for q in questions))
    header = f"{'Category':<18}" + "".join(f" {f:>8}" for f in formats)
    print(header)
    print("-" * len(header))
    for cat in cats:
        row = f"{CATEGORY_NAMES.get(cat, cat):<18}"
        for fmt in formats:
            cat_qs = [r for r in all_results_flat if r["format"] == fmt and r["category"] == cat]
            if cat_qs:
                c = sum(1 for r in cat_qs if r["correct"])
                row += f" {c}/{len(cat_qs):>5}"
            else:
                row += "      n/a"
        print(row)

    # Markdown table for README
    print(f"\n### Markdown (for README)\n")
    print("| Format | Accuracy | Correct / Total |")
    print("|---|---|---|")
    for fmt in formats:
        total = sum(len(v) for v in results[fmt].values())
        correct = sum(sum(1 for *_, ok in v if ok) for v in results[fmt].values())
        pct = correct / total * 100
        print(f"| {fmt} | **{pct:.1f}%** | {correct}/{total} |")

    # Final save
    _save_incremental()
    print(f"\nResults saved to {save_path}")


if __name__ == "__main__":
    main()
