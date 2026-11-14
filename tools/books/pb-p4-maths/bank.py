# P4 Maths question bank. Every answer is computed here and checked with assert.
import json, sys, random
from fractions import Fraction as Fr
sys.path.insert(0, '/tmp/pm')
from figs import bar_chart, rect_shape, shapes_row, grid_map, dissect_square

def F(a, b): return f"$\\dfrac{{{a}}}{{{b}}}$"
def MX(w, a, b): return f"${w}\\dfrac{{{a}}}{{{b}}}$"
def fr_txt(x):
    """Plain text answer for a fraction in lowest terms: '2 1/3', '3/4' or '5'."""
    x = Fr(x)
    if x.denominator == 1: return str(x.numerator)
    w, r = divmod(x.numerator, x.denominator)
    return f"{w} {r}/{x.denominator}" if w else f"{r}/{x.denominator}"
def fr_tex(x):
    x = Fr(x)
    if x.denominator == 1: return f"${x.numerator}$"
    w, r = divmod(x.numerator, x.denominator)
    return MX(w, r, x.denominator) if w else F(r, x.denominator)
def nf(n):  # HK style: thin space for 5+ digit numbers
    s = f"{n:,}".replace(',', ' ')
    return s if abs(n) >= 10000 else str(n)

B = {}; cur = None; pos = [0]
def unit(u): global cur; cur = u; B[u] = []
def add(q): B[cur].append(q)
LET = 'ABCD'
def M(level, stem, correct, wrongs, expl, fig=None):
    assert len(wrongs) == 3 and correct not in wrongs and len(set(wrongs)) == 3, (stem, correct, wrongs)
    k = pos[0] % 4; pos[0] += 1
    rnd = random.Random(len(B[cur]) * 7 + len(stem)); w = list(wrongs); rnd.shuffle(w)
    opts = w[:k] + [correct] + w[k:]
    q = {'type': 'mcq', 'level': level, 'stem': stem, 'options': [str(o) for o in opts], 'correct_option': LET[k], 'explanation': expl, 'parts': []}
    if fig: q['figure'] = {'img': fig}
    add(q)
def S(level, stem, answer, expl, accept='', fig=None, prompt='Write your answer.'):
    ms = f"Answer: {answer}" + (f". {accept}" if accept else '')
    q = {'type': 'short', 'level': level, 'stem': stem, 'parts': [{'label': '', 'prompt': prompt, 'marks': 1, 'mark_scheme': [ms], 'blank': True}], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)
def W(level, stem, method, answer, expl, marks=2, fig=None, extra=None):
    ms = [f"Method (1 mark): {method}"] + ([f"Working (1 mark): {extra}"] if extra else []) + [f"Answer (1 mark): {answer}. Accept an answer sentence or the number with the correct unit; give the method mark even if the final answer is wrong."]
    q = {'type': 'short', 'level': level, 'stem': stem, 'parts': [{'label': '', 'prompt': 'Show your working, then write an answer sentence.', 'marks': len(ms), 'mark_scheme': ms}], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)
def P(level, stem, parts, expl, fig=None):
    """Structured: parts = [(label, prompt, answer, accept)] each 1 mark, one-line answers."""
    q = {'type': 'structured', 'level': level, 'stem': stem, 'parts': [{'label': l, 'prompt': p, 'marks': 1, 'mark_scheme': [f"Answer: {a}" + (f". {acc}" if acc else '')], 'blank': True} for l, p, a, acc in parts], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)

def factors(n): return [d for d in range(1, n + 1) if n % d == 0]
def isprime(n): return n > 1 and len(factors(n)) == 2
from math import gcd
def lcm(*a):
    r = 1
    for x in a: r = r * x // gcd(r, x)
    return r
def hcf(*a):
    r = 0
    for x in a: r = gcd(r, x)
    return r

# ---------------- Unit 1: Multiplication ----------------
unit('u0')
assert 36 * 27 == 972
M(1, "Work out 36 × 27.", 972, [962, 324, 1072], "36 × 7 = 252 and 36 × 20 = 720. 252 + 720 = 972.")
S(1, "Work out in column form.\n\n47 × 23", 47 * 23, "47 × 3 = 141 and 47 × 20 = 940. 141 + 940 = 1081.")
assert 47 * 23 == 1081
S(2, "Work out in column form.\n\n235 × 46", 235 * 46, "235 × 6 = 1410 and 235 × 40 = 9400. 1410 + 9400 = 10 810.", accept="Accept 10810 or 10 810")
assert 235 * 46 == 10810
S(2, "Work out in column form.\n\n508 × 34", 508 * 34, "508 × 4 = 2032 and 508 × 30 = 15 240. 2032 + 15 240 = 17 272.", accept="Accept 17272 or 17 272")
assert 508 * 34 == 17272
M(2, "Which is the quickest way to work out 25 × 39 × 4?", "39 × (25 × 4)", ["(25 × 39) × 4", "25 × (39 × 4)", "(25 + 4) × 39"], "25 × 4 = 100, so 39 × (25 × 4) = 39 × 100 = 3900. The last option changes the answer.")
assert 25 * 39 * 4 == 3900
S(2, "Use a quick method to work out.\n\n8 × 47 × 125", 8 * 47 * 125, "8 × 125 = 1000, so 47 × 1000 = 47 000.", accept="Accept 47000 or 47 000")
assert 8 * 47 * 125 == 47000
M(2, "Which is the best estimate of 62 × 49?", "60 × 50 = 3000", ["60 × 40 = 2400", "70 × 50 = 3500", "62 + 49 = 111"], "Round 62 to 60 and 49 to 50. 60 × 50 = 3000. (The exact answer is 3038.)")
assert 62 * 49 == 3038
W(3, "A cinema has 28 rows of seats. Each row has 36 seats. All the seats are full for a film. How many people are watching the film?", "28 × 36", f"{28 * 36} people", "28 × 36 = 1008. There are 1008 people watching the film.")
assert 28 * 36 == 1008
W(3, "A school buys 45 boxes of exercise books. There are 120 books in each box. The school gives out 5000 books. How many books are left?", "45 × 120 − 5000 (or 45 × 120 = 5400, then 5400 − 5000)", f"{45 * 120 - 5000} books", "45 × 120 = 5400 books. 5400 − 5000 = 400. There are 400 books left.")
assert 45 * 120 - 5000 == 400

# ---------------- Unit 2: Division ----------------
unit('u1')
assert 96 // 24 == 4 and 96 % 24 == 0
M(1, "Work out 96 ÷ 24.", 4, [3, 5, 72], "24 × 4 = 96, so 96 ÷ 24 = 4.")
assert divmod(87, 16) == (5, 7)
S(1, "Work out. Write the remainder if there is one.\n\n87 ÷ 16", "5 R 7", "16 × 5 = 80 and 87 − 80 = 7. So 87 ÷ 16 = 5 R 7.", accept="Accept '5 remainder 7'")
assert 648 // 27 == 24 and 648 % 27 == 0
S(2, "Work out in column form.\n\n648 ÷ 27", 24, "64 ÷ 27 = 2 (54). 64 − 54 = 10, bring down 8: 108 ÷ 27 = 4. So the answer is 24.")
assert divmod(379, 42) == (9, 1)
S(2, "Work out in column form. Write the remainder if there is one.\n\n379 ÷ 42", "9 R 1", "37 is smaller than 42, so use 379. 42 × 9 = 378, remainder 1.", accept="Accept '9 remainder 1'")
assert divmod(925, 45) == (20, 25)
M(2, "What is 925 ÷ 45?", "20 R 25", ["2 R 25", "20 R 5", "21 R 20"], "92 ÷ 45 = 2 (90), remainder 2. Bring down 5: 25 ÷ 45 = 0. So the quotient is 20 and the remainder is 25. Don't forget the 0!")
M(2, "Mary worked out 500 ÷ 23 = 21 R 17. How can she check her answer?", "21 × 23 + 17", ["21 × 17 + 23", "23 × 17 + 21", "500 − 21 × 17"], "quotient × divisor + remainder = dividend. 21 × 23 + 17 = 483 + 17 = 500. ✓")
assert 21 * 23 + 17 == 500
S(2, "A number divided by 14 gives 23 R 9. What is the number?", 14 * 23 + 9, "14 × 23 + 9 = 322 + 9 = 331.")
assert 14 * 23 + 9 == 331
assert -(-250 // 32) == 8
W(3, "250 people are going on a trip. Each coach can carry 32 people. At least how many coaches are needed?", "250 ÷ 32 = 7 R 26", "8 coaches", "250 ÷ 32 = 7 R 26. The 26 people left over also need a coach, so 7 + 1 = 8 coaches are needed.")
assert 450 // 35 == 12
W(3, "Each bag of rice weighs 35 kg. A shop has 450 kg of rice. How many full bags can the shop make?", "450 ÷ 35 = 12 R 30", "12 full bags", "450 ÷ 35 = 12 R 30. The 30 kg left over is not enough for another full bag, so the shop can make 12 full bags.")

# ---------------- Unit 3: Divisibility ----------------
unit('u2')
M(1, "Which number is divisible by 5?", 2365, [2356, 3652, 5623], "A number is divisible by 5 if its ones digit is 0 or 5. Only 2365 ends in 5.")
M(1, "Which of these is an odd number?", 4087, [4078, 7804, 8740], "An odd number is not divisible by 2. Its ones digit is 1, 3, 5, 7 or 9. 4087 ends in 7.")
assert 1 + 3 + 5 + 2 == 11 and 1352 % 3 != 0 and 2412 % 3 == 0
M(2, "Which number is divisible by 3?", 2412, [1352, 4111, 2203], "Add the digits: 2 + 4 + 1 + 2 = 9, which is divisible by 3. The others: 1+3+5+2 = 11, 4+1+1+1 = 7, 2+2+0+3 = 7.")
for n in (2412,): assert n % 3 == 0
for n in (1352, 4111, 2203): assert n % 3 != 0
P(2, "Is 7290 divisible by each number? Write yes or no.", [("(a)", "by 2", "yes", "ends in 0"), ("(b)", "by 3", "yes", "7 + 2 + 9 + 0 = 18"), ("(c)", "by 5", "yes", ""), ("(d)", "by 10", "yes", "")], "7290 ends in 0, so it is divisible by 2, 5 and 10. 7 + 2 + 9 + 0 = 18, which is divisible by 3.")
assert all(7290 % d == 0 for d in (2, 3, 5, 10))
P(2, "Is 845 divisible by each number? Write yes or no.", [("(a)", "by 2", "no", "ends in 5"), ("(b)", "by 3", "no", "8 + 4 + 5 = 17"), ("(c)", "by 5", "yes", ""), ("(d)", "by 10", "no", "")], "845 ends in 5: divisible by 5 but not by 2 or 10. 8 + 4 + 5 = 17, which is not divisible by 3.")
assert 845 % 5 == 0 and 845 % 2 and 845 % 3 and 845 % 10
cnt = len([n for n in range(45, 159) if n % 10 == 0]); assert cnt == 11
S(2, "How many numbers from 45 to 158 are divisible by 10?", cnt, "The numbers are 50, 60, 70, …, 150. That is 11 numbers.")
ok = [d for d in range(10) if (5 + d + 2) % 3 == 0]; assert ok == [2, 5, 8]
S(3, "5□2 is divisible by 3. What are all the possible digits for □?", "2, 5 and 8", "5 + □ + 2 must be divisible by 3. 7 + 2 = 9, 7 + 5 = 12, 7 + 8 = 15. So □ can be 2, 5 or 8.", accept="All three digits are needed for the mark")
sm = min(n for n in range(100, 1000) if n % 2 == 0 and n % 3 == 0 and n % 5 == 0); assert sm == 120
S(3, "What is the smallest 3-digit number that is divisible by 2, 3 and 5?", sm, "It must end in 0 (for 2 and 5). Try 100 (1 + 0 + 0 = 1, no), 110 (2, no), 120 (3, yes). So the answer is 120.")

# ---------------- Unit 4: Multiples and factors ----------------
unit('u3')
M(1, "Which number is a multiple of 7?", 98, [27, 47, 76], "98 ÷ 7 = 14 with no remainder, so 98 is a multiple of 7.")
assert 98 % 7 == 0 and all(x % 7 for x in (27, 47, 76))
S(1, "List the first 5 multiples of 9.", "9, 18, 27, 36, 45", "9 × 1, 9 × 2, 9 × 3, 9 × 4, 9 × 5.", accept="All five, in any order")
assert factors(42) == [1, 2, 3, 6, 7, 14, 21, 42]
S(1, "List all the factors of 42.", "1, 2, 3, 6, 7, 14, 21, 42", "Pairs: 1 × 42, 2 × 21, 3 × 14, 6 × 7.", accept="All eight factors, in any order; no extra numbers")
assert factors(64) == [1, 2, 4, 8, 16, 32, 64]
S(2, "List all the factors of 64.", "1, 2, 4, 8, 16, 32, 64", "Pairs: 1 × 64, 2 × 32, 4 × 16, 8 × 8.", accept="All seven factors, in any order; no extra numbers")
M(2, "Which number is NOT a factor of 36?", 8, [4, 9, 12], "36 ÷ 8 = 4 R 4, so 8 is not a factor of 36. 4, 9 and 12 all divide 36 exactly.")
assert 36 % 8 and all(36 % x == 0 for x in (4, 9, 12))
M(2, "54 ÷ 6 = 9. Which sentence is correct?", "54 is a multiple of 6.", ["6 is a multiple of 54.", "54 is a factor of 6.", "9 is a multiple of 54."], "Because 54 ÷ 6 = 9 with no remainder, 6 is a factor of 54 and 54 is a multiple of 6.")
assert 7 * 5 - 8 * 4 == 3
S(2, "What is the difference between the 5th multiple of 7 and the 4th multiple of 8?", 3, "5th multiple of 7: 35. 4th multiple of 8: 32. 35 − 32 = 3.")
S(3, "I am a multiple of 6. I am also a factor of 72. I am between 20 and 30. What number am I?", 24, "Multiples of 6 between 20 and 30: 24. Is 24 a factor of 72? 72 ÷ 24 = 3. Yes.")
assert [n for n in range(21, 30) if n % 6 == 0 and 72 % n == 0] == [24]

# ---------------- Unit 5: Prime and composite numbers ----------------
unit('u4')
M(1, "Which of these is a prime number?", 29, [21, 27, 39], "29 has only two factors: 1 and 29. 21 = 3 × 7, 27 = 3 × 9, 39 = 3 × 13.")
assert isprime(29) and not any(isprime(x) for x in (21, 27, 39))
M(1, "Which statement about 1 is correct?", "1 is neither prime nor composite.", ["1 is a prime number.", "1 is a composite number.", "1 is both prime and composite."], "1 has only one factor, so it is neither prime nor composite.")
M(2, "What is the largest prime number below 100?", 97, [91, 93, 99], "91 = 7 × 13, 93 = 3 × 31 and 99 = 9 × 11 are composite. 97 is prime.")
assert isprime(97) and not any(isprime(x) for x in (91, 93, 99))
pr = [n for n in range(40, 61) if isprime(n)]; assert pr == [41, 43, 47, 53, 59]
S(2, "List all the prime numbers between 40 and 60.", ", ".join(map(str, pr)), "Check each odd number: 41, 43, 47, 53 and 59 have only two factors. 45, 49 (7 × 7), 51 (3 × 17), 55 and 57 (3 × 19) are composite.", accept="All five; no composite numbers")
M(2, "Which number is composite?", 51, [53, 59, 61], "5 + 1 = 6, so 51 is divisible by 3: 51 = 3 × 17. It has more than two factors.")
assert not isprime(51) and all(isprime(x) for x in (53, 59, 61))
P(2, "Write P for prime or C for composite.", [("(a)", "57", "C", "57 = 3 × 19"), ("(b)", "67", "P", ""), ("(c)", "77", "C", "77 = 7 × 11"), ("(d)", "83", "P", "")], "57 = 3 × 19 and 77 = 7 × 11 are composite. 67 and 83 are prime.")
assert not isprime(57) and isprime(67) and not isprime(77) and isprime(83)
cnt = len([n for n in range(1, 31) if isprime(n)]); assert cnt == 10
S(2, "How many prime numbers are there from 1 to 30?", cnt, "2, 3, 5, 7, 11, 13, 17, 19, 23, 29: that is 10 prime numbers.")
S(3, "Two different prime numbers add up to 24. Write one possible pair.", "5 and 19, 7 and 17, or 11 and 13", "Check pairs of primes: 5 + 19, 7 + 17 and 11 + 13 all make 24.", accept="Any one of these pairs")
assert all(isprime(a) and isprime(24 - a) for a in (5, 7, 11))

# ---------------- Unit 6: Common multiples and L.C.M. ----------------
unit('u5')
M(1, "Which number is a common multiple of 4 and 6?", 36, [16, 18, 30], "36 ÷ 4 = 9 and 36 ÷ 6 = 6. The others are multiples of only one of them.")
assert 36 % 4 == 0 and 36 % 6 == 0 and all((x % 4) or (x % 6) for x in (16, 18, 30))
assert lcm(8, 12) == 24
S(1, "Find the L.C.M. of 8 and 12.", 24, "Multiples of 12: 12, 24, … 24 is also a multiple of 8. So the L.C.M. is 24.")
assert lcm(15, 20) == 60
S(2, "Find the L.C.M. of 15 and 20 by short division.", 60, "5 | 15, 20 → 3, 4. L.C.M. = 5 × 3 × 4 = 60.")
assert lcm(6, 9, 12) == 36
S(2, "Find the L.C.M. of 6, 9 and 12.", 36, "2 | 6, 9, 12 → 3, 9, 6; 3 | 3, 9, 6 → 1, 3, 2. L.C.M. = 2 × 3 × 1 × 3 × 2 = 36.")
M(2, "What is the L.C.M. of 7 and 42?", 42, [7, 84, 294], "42 is a multiple of 7, so the L.C.M. is the bigger number, 42.")
assert lcm(7, 42) == 42
cm = [n for n in range(1, 101) if n % 9 == 0 and n % 15 == 0]; assert cm == [45, 90]
S(2, "List all the common multiples of 9 and 15 that are less than 100.", "45, 90", "The L.C.M. of 9 and 15 is 45. Its multiples below 100 are 45 and 90.", accept="Both numbers")
assert lcm(8, 12) * 4 == 96
M(2, "The first common multiple of 8 and 12 is 24. What is their 4th common multiple?", 96, [48, 72, 120], "Common multiples are multiples of the L.C.M.: 24, 48, 72, 96. The 4th one is 96.")
assert lcm(12, 15) == 60
W(3, "Bus 1 leaves the bus terminus every 12 minutes. Bus 2 leaves every 15 minutes. Both buses leave at 9:00 a.m. When will they next leave together?", "find the L.C.M. of 12 and 15 = 60", "10:00 a.m.", "The L.C.M. of 12 and 15 is 60. 60 minutes after 9:00 a.m. is 10:00 a.m.")
assert lcm(6, 8) == 24
W(3, "Some sweets can be shared equally among 6 children or among 8 children with none left over. What is the smallest possible number of sweets?", "find the L.C.M. of 6 and 8", "24 sweets", "The L.C.M. of 6 and 8 is 24, so the smallest number is 24.")

# ---------------- Unit 7: Common factors and H.C.F. ----------------
unit('u6')
cf = [d for d in factors(16) if 56 % d == 0]; assert cf == [1, 2, 4, 8]
S(1, "List all the common factors of 16 and 56.", "1, 2, 4, 8", "Factors of 16: 1, 2, 4, 8, 16. Of these, 1, 2, 4 and 8 divide 56.", accept="All four")
assert hcf(12, 30) == 6
S(1, "Find the H.C.F. of 12 and 30.", 6, "Factors of 12: 1, 2, 3, 4, 6, 12. Factors of 30: 1, 2, 3, 5, 6, 10, 15, 30. Common: 1, 2, 3, 6. H.C.F. = 6.")
assert hcf(72, 96) == 24
S(2, "Find the H.C.F. of 72 and 96 by short division.", 24, "2 | 72, 96 → 36, 48; 2 | 36, 48 → 18, 24; 2 | 18, 24 → 9, 12; 3 | 9, 12 → 3, 4. H.C.F. = 2 × 2 × 2 × 3 = 24.")
assert hcf(18, 27, 45) == 9
S(2, "Find the H.C.F. of 18, 27 and 45.", 9, "3 | 18, 27, 45 → 6, 9, 15; 3 | 6, 9, 15 → 2, 3, 5. H.C.F. = 3 × 3 = 9.")
M(1, "What is the H.C.F. of 4 and 13?", 1, [4, 13, 52], "13 is a prime number and 4 is not a multiple of 13. The only common factor is 1.")
assert hcf(4, 13) == 1
M(2, "What is the H.C.F. of 9 and 63?", 9, [3, 7, 63], "63 is a multiple of 9 (9 × 7), so the H.C.F. is the smaller number, 9.")
assert hcf(9, 63) == 9
M(2, "In the short division of 20 and 30, which shows how to find the H.C.F.?\n\n2 | 20, 30\n5 | 10, 15\n      2, 3", "2 × 5 = 10", ["2 × 5 × 2 × 3 = 60", "2 × 3 = 6", "20 + 30 = 50"], "For the H.C.F., multiply only the numbers on the left: 2 × 5 = 10. (2 × 5 × 2 × 3 = 60 is the L.C.M.)")
assert hcf(20, 30) == 10 and lcm(20, 30) == 60
assert hcf(24, 36) == 12
W(3, "Miss Chan has 24 apples and 36 oranges. She puts them into bags so that every bag is the same, with no fruit left over. What is the greatest number of bags she can make?", "find the H.C.F. of 24 and 36", "12 bags", "The H.C.F. of 24 and 36 is 12. She can make 12 bags, each with 2 apples and 3 oranges.")
assert hcf(48, 40) == 8
W(3, "A rectangular piece of paper is 48 cm long and 40 cm wide. It is cut into squares that are all the same size, with no paper left over. What is the biggest possible length of each side of a square?", "find the H.C.F. of 48 and 40", "8 cm", "The H.C.F. of 48 and 40 is 8, so each square has a side of 8 cm.")

# ---------------- Unit 8: Mixed operations ----------------
unit('u7')
assert 32 // 8 * 4 == 16 and 32 % 8 == 0
M(1, "Work out 32 ÷ 8 × 4.", 16, [1, 128, 2], "Do × and ÷ from left to right: 32 ÷ 8 = 4, then 4 × 4 = 16.")
assert 117 - 224 // 16 == 103 and 224 % 16 == 0
S(1, "Work out.\n\n117 − 224 ÷ 16", 103, "Divide first: 224 ÷ 16 = 14. Then 117 − 14 = 103.")
v = (78 - 59) * 23 + 182 // 13; assert v == 451 and 182 % 13 == 0
S(2, "Work out. Show your steps.\n\n(78 − 59) × 23 + 182 ÷ 13", v, "= 19 × 23 + 182 ÷ 13 = 437 + 14 = 451.")
v = 47 + 96 // 16 * 25; assert v == 197 and 96 % 16 == 0
S(2, "Work out.\n\n47 + 96 ÷ 16 × 25", v, "= 47 + 6 × 25 = 47 + 150 = 197.")
v = (6 + 9) * (40 - 32); assert v == 120
S(2, "Work out.\n\n(6 + 9) × (40 − 32)", v, "= 15 × 8 = 120.")
assert 37 * 26 + 37 * 74 == 3700
M(2, "Which is the quickest way to work out 37 × 26 + 37 × 74?", "37 × (26 + 74)", ["(37 + 37) × (26 + 74)", "37 × 26 × 74", "(37 + 26) × 74"], "Both parts have 37 ×, so 37 × (26 + 74) = 37 × 100 = 3700.")
assert 64 * 99 == 6336
S(2, "Use the distributive property to work out 64 × 99.", 6336, "64 × 99 = 64 × (100 − 1) = 6400 − 64 = 6336.")
assert 42 // 6 * 9 == 63 and 42 % 6 == 0
W(2, "6 cans of drink cost 42 dollars. How much do 9 cans cost?", "42 ÷ 6 × 9", "63 dollars", "1 can costs 42 ÷ 6 = 7 dollars. 9 cans cost 7 × 9 = 63 dollars.")
assert 500 - 3 * 85 - 4 * 38 == 93
W(3, "Dad has 500 dollars. He buys 3 shirts at 85 dollars each and 4 pairs of socks at 38 dollars a pair. How much money does he have left?", "500 − 85 × 3 − 38 × 4", "93 dollars", "500 − 255 − 152 = 93. He has 93 dollars left.", marks=3, extra="500 − 255 − 152")

# ---------------- Unit 9: Fractions ----------------
unit('u8')
M(1, "Which of these is an improper fraction?", F(9, 7), [F(7, 9), MX(1, 2, 7), F(1, 7)], "In an improper fraction the numerator is equal to or bigger than the denominator. 9 > 7.")
S(1, f"Change {MX(2, 7, 12)} into an improper fraction.", "31/12", "2 × 12 + 7 = 31, so the answer is 31/12.")
assert 2 * 12 + 7 == 31
assert divmod(35, 3) == (11, 2)
S(1, f"Change {F(35, 3)} into a mixed number.", "11 2/3", "35 ÷ 3 = 11 R 2, so 35/3 = 11 2/3.")
assert Fr(12, 28) == Fr(3, 7)
S(2, f"Fill in the blank.\n\n{F(12, 28)} = $\\dfrac{{\\square}}{{7}}$", 3, "28 ÷ 4 = 7, so divide the numerator by 4 too: 12 ÷ 4 = 3.")
assert Fr(7, 14) == Fr(56, 112)
S(2, f"Fill in the blank.\n\n{F(7, 14)} = $\\dfrac{{\\square}}{{112}}$", 56, "14 × 8 = 112, so multiply the numerator by 8 too: 7 × 8 = 56.")
assert Fr(48, 60) == Fr(4, 5)
S(2, f"Reduce {F(48, 60)} to its lowest terms.", "4/5", "The H.C.F. of 48 and 60 is 12. 48 ÷ 12 = 4 and 60 ÷ 12 = 5.", accept="Only 4/5 (not 8/10 or 16/20)")
M(2, "Which fraction is in its lowest terms?", F(9, 14), [F(9, 15), F(14, 21), F(6, 16)], "The H.C.F. of 9 and 14 is 1. The others can still be reduced: 9/15 = 3/5, 14/21 = 2/3, 6/16 = 3/8.")
assert hcf(9, 14) == 1 and hcf(9, 15) > 1 and hcf(14, 21) > 1 and hcf(6, 16) > 1
vals = {'A': Fr(19, 8), 'B': Fr(2) + Fr(5, 8), 'C': Fr(2)}; assert vals['B'] > vals['A'] > vals['C']
M(2, f"Which is the largest?", MX(2, 5, 8), [F(19, 8), "$2$", F(15, 8)], "Change to eighths: 2 5/8 = 21/8, 19/8, 2 = 16/8, 15/8. The largest is 21/8 = 2 5/8.")
S(3, f"Arrange from smallest to largest: {F(13, 6)}, {MX(1, 5, 6)}, $2$, {F(7, 6)}", "7/6, 1 5/6, 2, 13/6", "Change to sixths: 13/6, 11/6, 12/6, 7/6. Smallest to largest: 7/6, 11/6 (1 5/6), 12/6 (2), 13/6.", accept="All four in the correct order")
assert sorted([Fr(13, 6), Fr(11, 6), Fr(2), Fr(7, 6)]) == [Fr(7, 6), Fr(11, 6), Fr(2), Fr(13, 6)]

# ---------------- Unit 10: Adding and subtracting fractions ----------------
unit('u9')
r = Fr(5, 8) + Fr(7, 8); assert r == Fr(3, 2)
S(1, f"Work out. Give your answer in its lowest terms.\n\n{F(5, 8)} + {F(7, 8)}", fr_txt(r), "5/8 + 7/8 = 12/8 = 3/2 = 1 1/2.", accept="Accept 3/2")
r = Fr(9, 10) - Fr(3, 10); assert r == Fr(3, 5)
S(1, f"Work out. Give your answer in its lowest terms.\n\n{F(9, 10)} − {F(3, 10)}", fr_txt(r), "9/10 − 3/10 = 6/10 = 3/5.")
M(1, f"Ken wrote {F(2, 9)} + {F(4, 9)} = {F(6, 18)}. What mistake did he make?", "He added the denominators.", ["He added the numerators.", "He did not reduce the answer.", "There is no mistake."], "Keep the denominator the same: 2/9 + 4/9 = 6/9 = 2/3.")
r = Fr(2) + Fr(4, 7) + Fr(1) + Fr(5, 7); assert r == Fr(30, 7)
S(2, f"Work out.\n\n{MX(2, 4, 7)} + {MX(1, 5, 7)}", fr_txt(r), "2 4/7 + 1 5/7 = 3 9/7 = 4 2/7.", accept="Accept 30/7")
r = Fr(5) + Fr(1, 6) - (Fr(2) + Fr(5, 6)); assert r == Fr(7, 3)
S(2, f"Work out. Give your answer in its lowest terms.\n\n{MX(5, 1, 6)} − {MX(2, 5, 6)}", fr_txt(r), "5 1/6 − 2 5/6 = 4 7/6 − 2 5/6 = 2 2/6 = 2 1/3.", accept="Accept 7/3")
r = Fr(11, 12) + Fr(7, 12) - Fr(5, 12); assert r == Fr(13, 12)
S(2, f"Work out.\n\n{F(11, 12)} + {F(7, 12)} − {F(5, 12)}", fr_txt(r), "= 18/12 − 5/12 = 13/12 = 1 1/12.", accept="Accept 13/12")
r = Fr(4) - Fr(1) - Fr(3, 8) - Fr(7, 8); assert r == Fr(7, 4)
S(3, f"Work out. Give your answer in its lowest terms.\n\n$4$ − {MX(1, 3, 8)} − {F(7, 8)}", fr_txt(r), "4 − 1 3/8 = 2 5/8. 2 5/8 − 7/8 = 1 13/8 − 7/8 = 1 6/8 = 1 3/4.", accept="Accept 7/4")
r = Fr(5) + Fr(2, 5) - (Fr(1) + Fr(4, 5)); assert r == Fr(18, 5)
W(3, f"A ribbon is {MX(5, 2, 5)} m long. Amy uses {MX(1, 4, 5)} m to tie a present. How long is the ribbon left?", "5 2/5 − 1 4/5", f"{fr_txt(r)} m", "5 2/5 − 1 4/5 = 4 7/5 − 1 4/5 = 3 3/5. The ribbon left is 3 3/5 m long.")
r = 1 - Fr(3, 10) - Fr(4, 10); assert r == Fr(3, 10)
W(3, f"A tank of water is full. On Monday, {F(3, 10)} of the water is used. On Tuesday, {F(4, 10)} of the water is used. What fraction of the water is left?", "1 − 3/10 − 4/10", f"{fr_txt(r)} of the water", "1 = 10/10. 10/10 − 3/10 − 4/10 = 3/10.")

# ---------------- Unit 11: Decimals ----------------
unit('u10')
M(1, "In 21.76, what is the value of the digit 6?", F(6, 100), [F(1, 10), F(6, 10), F(6, 1000)], "6 is in the hundredths place, so its value is 6/100 (0.06).")
M(1, "How do we read 30.405?", "thirty point four zero five", ["thirty point four hundred and five", "three zero point four zero five", "thirty point forty-five"], "Read the whole number part normally, say 'point', then read each digit after the point one by one.")
M(1, "How many decimal places does 0.1224 have?", 4, [1, 2, 3], "Count the digits after the decimal point: 1, 2, 2, 4. That is 4 decimal places.")
S(1, "Write as a decimal: 4 tens, 3 ones, 7 tenths and 2 thousandths.", "43.702", "43 is the whole number part. Tenths: 7, hundredths: 0, thousandths: 2.")
M(2, "Which number is the largest?", "0.8", ["0.75", "0.709", "0.078"], "Compare the tenths first: 0.8 has 8 tenths, the others have 7 or 0 tenths. So 0.8 is the largest.")
assert max([0.8, 0.75, 0.709, 0.078]) == 0.8
S(2, "Arrange from smallest to largest: 2.6, 2.06, 2.606, 2.66", "2.06, 2.6, 2.606, 2.66", "Compare the tenths: 2.06 has 0 tenths (smallest). 2.6 = 2.600, 2.606 and 2.66 = 2.660, so 2.6 < 2.606 < 2.66.", accept="All four in the correct order")
assert sorted([2.6, 2.06, 2.606, 2.66]) == [2.06, 2.6, 2.606, 2.66]
M(2, f"Which decimal is equal to {F(3, 4)}?", "0.75", ["0.34", "0.43", "3.4"], "3/4 = 75/100 = 0.75.")
assert Fr(3, 4) == Fr(75, 100)
P(2, "Fill in the blanks.", [("(a)", "6 dollars 5 cents = ____ dollars", "6.05", "not 6.5"), ("(b)", "2.35 m = ____ cm", "235", ""), ("(c)", "1.25 L = ____ mL", "1250", "")], "5 cents is 5 hundredths of a dollar: 6.05. 1 m = 100 cm, so 2.35 m = 235 cm. 1 L = 1000 mL, so 1.25 L = 1250 mL.")
M(3, "Which is the same as 0.6?", F(3, 5), [F(1, 6), F(6, 100), F(6, 1000)], "0.6 = 6/10 = 3/5.")
assert Fr(3, 5) == Fr(6, 10)

# ---------------- Unit 12: Adding and subtracting decimals ----------------
unit('u11')
from decimal import Decimal as D
def d(s): return D(s)
assert d('18.5') + d('7.8') == d('26.3')
S(1, "Work out.\n\n18.5 + 7.8", "26.3", "Line up the decimal points. 5 + 8 = 13 tenths: write 3, carry 1. 18 + 7 + 1 = 26. Answer: 26.3.")
assert d('9') - d('3.65') == d('5.35')
S(1, "Work out.\n\n9 − 3.65", "5.35", "Write 9 as 9.00. 9.00 − 3.65 = 5.35.")
assert d('6.4') + d('2.75') == d('9.15')
M(1, "Work out 6.4 + 2.75.", "9.15", ["3.39", "2.815", "8.15"], "Write 6.4 as 6.40 and line up the decimal points: 6.40 + 2.75 = 9.15.")
assert d('12.3') - d('4.86') == d('7.44')
S(2, "Work out.\n\n12.3 − 4.86", "7.44", "12.30 − 4.86 = 7.44 (borrow from the tenths and the ones).")
assert d('15.6') + d('4.25') - d('7.8') == d('12.05')
S(2, "Work out.\n\n15.6 + 4.25 − 7.8", "12.05", "15.6 + 4.25 = 19.85. 19.85 − 7.8 = 12.05.")
assert d('50') - d('19.26') - d('10.41') == d('20.33')
S(2, "Work out.\n\n50 − 19.26 − 10.41", "20.33", "50 − 19.26 = 30.74. 30.74 − 10.41 = 20.33.")
assert d('3.75') + d('4.6') + d('1.25') == d('9.6')
M(2, "Which is the quickest way to work out 3.75 + 4.6 + 1.25?", "(3.75 + 1.25) + 4.6", ["(3.75 + 4.6) + 1.25", "3.75 + (4.6 − 1.25)", "(4.6 + 1.25) − 3.75"], "3.75 + 1.25 = 5, a whole number. Then 5 + 4.6 = 9.6.")
assert d('100') - d('32.5') - d('45.8') == d('21.7')
W(3, "Mum has 100 dollars. She spends 32.5 dollars on vegetables and 45.8 dollars on fish. How much money does she have left?", "100 − 32.5 − 45.8", "21.7 dollars (21 dollars 70 cents)", "100 − 32.5 = 67.5. 67.5 − 45.8 = 21.7. She has 21.7 dollars left.")
assert d('1.35') + d('0.48') == d('1.83')
W(3, "Ming is 1.35 m tall. His father is 0.48 m taller than Ming. How tall is his father?", "1.35 + 0.48", "1.83 m", "1.35 + 0.48 = 1.83. His father is 1.83 m tall.")

# ---------------- Unit 13: Quadrilaterals ----------------
unit('u12')
SQ = [(0.3, 0.3), (2.7, 0.3), (2.7, 2.7), (0.3, 2.7)]
RECT = [(0, 0.8), (3, 0.8), (3, 2.4), (0, 2.4)]
RHOM = [(1.5, 0.4), (3.2, 1.5), (1.5, 2.6), (-0.2, 1.5)]
PARA = [(0, 0.5), (2.2, 0.5), (3, 2.3), (0.8, 2.3)]
TRAP = [(0, 0.5), (3, 0.5), (2.2, 2.3), (0.8, 2.3)]
fig4 = shapes_row([('1', RECT), ('2', RHOM), ('3', TRAP), ('4', PARA)])
M(1, "Which shape is a rhombus?", "Shape 2", ["Shape 1", "Shape 3", "Shape 4"], "Shape 2 has 4 equal sides and its opposite sides are parallel, so it is a rhombus. Shape 1 is a rectangle, Shape 3 is a trapezium and Shape 4 is a parallelogram.", fig=fig4)
M(1, "Which of these is true for every rhombus?", "All 4 sides are equal.", ["All 4 angles are right angles.", "It has only 1 pair of parallel sides.", "Only 2 sides are equal."], "A rhombus has 4 equal sides and 2 pairs of parallel sides. Its angles do not have to be right angles.")
M(2, "Which shape has only one pair of parallel sides?", "Shape 3", ["Shape 1", "Shape 2", "Shape 4"], "Shape 3 is a trapezium: only the top and bottom sides are parallel. Shapes 1, 2 and 4 all have 2 pairs of parallel sides.", fig=fig4)
M(2, "Which statement is correct?", "A square is a rhombus.", ["A rhombus is always a square.", "A rectangle is always a square.", "A trapezium is a parallelogram."], "A square has 4 equal sides, so it is a special rhombus. But a rhombus does not need right angles, so it is not always a square.")
P(2, "Write true (T) or false (F).", [("(a)", "Every square is a rectangle.", "T", ""), ("(b)", "Every rectangle is a parallelogram.", "T", ""), ("(c)", "Every parallelogram is a rhombus.", "F", "a parallelogram need not have 4 equal sides"), ("(d)", "Every rhombus is a parallelogram.", "T", "")], "Squares, rectangles and rhombuses all have 2 pairs of parallel sides, so they are all parallelograms. A parallelogram only needs opposite sides equal, so it is not always a rhombus.")
S(2, "A rhombus has a perimeter of 52 cm. How long is each side?", "13 cm", "A rhombus has 4 equal sides. 52 ÷ 4 = 13 cm.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 52 // 4 == 13
M(3, "A quadrilateral has 4 equal sides and 4 right angles. Which names can we give it?", "square, rhombus, rectangle and parallelogram", ["square only", "square and rhombus only", "rhombus and trapezium"], "It is a square. A square is also a rhombus (4 equal sides), a rectangle (4 right angles) and a parallelogram (2 pairs of parallel sides).")

# ---------------- Unit 14: Dissecting and forming shapes ----------------
unit('u13')
M(1, "A rectangle is cut from one corner to the opposite corner. What two shapes do we get?", "two right-angled triangles", ["two rectangles", "two squares", "two trapeziums"], "Each piece has 3 sides and keeps one right angle of the rectangle, so each is a right-angled triangle.")
M(1, "A square is cut from one corner to the opposite corner. What kind of triangles do we get?", "isosceles right-angled triangles", ["equilateral triangles", "triangles with no equal sides", "triangles with no right angle"], "Each triangle has a right angle (a corner of the square) and two equal sides (two sides of the square).")
fsq = dissect_square()
S(2, "How many small triangles are there in the picture?", 4, "The two dashed lines cross in the middle and make 4 small triangles.", fig=fsq)
M(2, "Look at the picture again. What kind of triangle is each small triangle?", "isosceles right-angled triangle", ["equilateral triangle", "right-angled triangle with no equal sides", "a triangle with no right angle"], "The two lines from corner to corner of a square meet at right angles and are cut into equal halves, so each small triangle has a right angle and two equal sides.", fig=fsq)
M(2, "Which shape can be made from 2 identical right-angled trapeziums?", "a rectangle", ["a circle", "a triangle", "a pentagon with 5 equal sides"], "Turn one right-angled trapezium round and put the two slanted sides together: they make a rectangle.")
M(2, "Two identical right-angled triangles each have shorter sides of 3 cm and 4 cm. Which shape can NOT be formed by putting them together?", "a square", ["a rectangle", "a parallelogram", "an isosceles triangle"], "They can make a 3 cm × 4 cm rectangle, a parallelogram or an isosceles triangle. They cannot make a square, because the sides would not all be equal.")
S(2, "How many identical equilateral triangles are needed to form a regular hexagon like the ones in a honeycomb?", 6, "Six equilateral triangles meet at the centre of a regular hexagon.")
M(3, "A parallelogram is cut by one straight line that makes a right angle with its bottom side, starting from a top corner. What are the two pieces?", "a right-angled triangle and a right-angled trapezium", ["two rectangles", "two squares", "two equilateral triangles"], "The cut makes a right angle with the bottom. The small piece has 3 sides and a right angle; the big piece has 4 sides, 1 pair of parallel sides and right angles.")

# ---------------- Unit 15: The eight directions ----------------
unit('u14')
M(1, "Which direction is between north and west?", "northwest", ["northeast", "southwest", "westnorth"], "Between north and west is northwest (NW). North or south always comes first.")
M(1, "You face north and turn right by one right angle. Which way do you face now?", "east", ["west", "south", "northeast"], "Turning right is clockwise. A quarter turn clockwise from north is east.")
M(2, "You face east and turn left by two right angles. Which way do you face now?", "west", ["north", "south", "northwest"], "Two right angles is a half turn. A half turn from east is west.")
M(2, "You face southwest and turn right by one right angle. Which way do you face now?", "northwest", ["southeast", "west", "northeast"], "Clockwise from southwest: west (half a right angle), then northwest (one right angle).")
mp = grid_map([(1, 1, 'School'), (4, 1, 'Library'), (4, 4, 'Park'), (1, 4, 'Market'), (7, 4, 'MTR'), (7, 1, 'Pool')], w=8, h=5)
P(2, "Look at the map. North is at the top. Fill in the directions.", [("(a)", "The Library is to the ____ of the School.", "east", ""), ("(b)", "The Park is to the ____ of the School.", "northeast", ""), ("(c)", "The School is to the ____ of the Park.", "southwest", ""), ("(d)", "The Pool is to the ____ of the Park.", "southeast", "")], "On the map, right is east and up is north. The Park is up and to the right of the School (northeast). Going back, the School is southwest of the Park. The Pool is down and to the right of the Park (southeast).", fig=mp)
M(2, "Look at the map. Which place is to the northwest of the Library?", "Market", ["Park", "MTR", "Pool"], "From the Library, go up (north) and to the left (west): the Market.", fig=mp)
M(2, "A compass needle always points to the …", "north", ["east", "south", "west"], "The needle of a compass points north. Turn the compass until the needle lines up with N, then read the other directions.")
M(3, "A is to the north of B. C is to the east of B, the same distance away. In which direction is C from A?", "southeast", ["northeast", "southwest", "northwest"], "Start at A. To reach C, go down (south) to B's row, then right (east). That is southeast.")
M(3, "You face northwest and turn left by three right angles. Which way do you face now?", "northeast", ["southwest", "southeast", "northwest"], "Three right angles to the left is the same as one right angle to the right. One right angle clockwise from northwest is northeast.")

# ---------------- Unit 16: Perimeter ----------------
unit('u15')
assert (14 + 9) * 2 == 46
S(1, "Find the perimeter of a rectangle 14 cm long and 9 cm wide.", "46 cm", "(14 + 9) × 2 = 23 × 2 = 46 cm.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 17 * 4 == 68
S(1, "Find the perimeter of a square with sides of 17 m.", "68 m", "17 × 4 = 68 m.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
M(1, "Which unit can we use for perimeter?", "cm", ["cm²", "kg", "mL"], "Perimeter is a length, so we use cm, m or km. cm² is for area.")
assert 84 // 4 == 21
S(2, "A square has a perimeter of 84 cm. How long is each side?", "21 cm", "84 ÷ 4 = 21 cm.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 50 // 2 - 16 == 9
S(2, "A rectangle has a perimeter of 50 cm. Its length is 16 cm. What is its width?", "9 cm", "Length + width = 50 ÷ 2 = 25 cm. Width = 25 − 16 = 9 cm.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
L = [(0, 0), (10, 0), (10, 4), (4, 4), (4, 9), (0, 9)]
figL = rect_shape(L, [(5, -0.55, '10 cm'), (10.75, 2, '4 cm'), (7, 4.5, '6 cm'), (4.75, 6.5, '5 cm'), (2, 9.5, '4 cm'), (-0.85, 4.5, '9 cm')], size=(3.8, 3.4))
assert 10 + 4 + 6 + 5 + 4 + 9 == 38
S(2, "Find the perimeter of the shape. All the corners are right angles.", "38 cm", "Add all 6 sides: 10 + 4 + 6 + 5 + 4 + 9 = 38 cm.", fig=figL, accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
L2 = [(0, 0), (8, 0), (8, 3), (5, 3), (5, 7), (0, 7)]
figL2 = rect_shape(L2, [(4, -0.55, '8 cm'), (8.75, 1.5, '3 cm'), (-0.85, 3.5, '7 cm')], size=(3.6, 3.2))
assert 8 + 7 + 8 + 7 == 30
S(3, "All the corners are right angles. Find the perimeter of the shape.", "30 cm", "The two top sides add up to the bottom side (8 cm) and the two right sides add up to the left side (7 cm). Perimeter = 8 + 8 + 7 + 7 = 30 cm.", fig=figL2, accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert (12 * 2 + 6 * 2) == 36
W(3, "Two identical squares with sides of 6 cm are put side by side to make a rectangle. What is the perimeter of the rectangle?", "rectangle is 12 cm by 6 cm; (12 + 6) × 2", "36 cm", "The rectangle is 6 + 6 = 12 cm long and 6 cm wide. (12 + 6) × 2 = 36 cm.")
assert 64 // 8 == 8 and 8 * 3 == 24
W(3, "The length of a rectangle is 3 times its width. Its perimeter is 64 cm. Find its length.", "length + width = 32; 4 equal parts of 8 cm", "24 cm", "Length + width = 64 ÷ 2 = 32 cm. Width is 1 part and length is 3 parts: 4 parts = 32 cm, so 1 part = 8 cm. Length = 8 × 3 = 24 cm.")

# ---------------- Unit 17: Area ----------------
unit('u16')
M(1, "Which unit is best for the area of a classroom floor?", "m²", ["cm²", "m", "cm"], "A classroom floor is big, so we use square metres (m²). m and cm are units of length.")
assert 12 * 7 == 84
S(1, "Find the area of a rectangle 12 cm long and 7 cm wide.", "84 cm²", "12 × 7 = 84 cm².", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 9 * 9 == 81
S(1, "Find the area of a square with sides of 9 m.", "81 m²", "9 × 9 = 81 m².", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 72 // 8 == 9
S(2, "A rectangle has an area of 72 m². Its length is 8 m. What is its width?", "9 m", "Width = 72 ÷ 8 = 9 m.", accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
M(2, "A square has an area of 64 cm². How long is each side?", "8 cm", ["16 cm", "32 cm", "4 cm"], "8 × 8 = 64, so each side is 8 cm.")
G = [(0, 0), (6, 0), (6, 2), (3, 2), (3, 4), (0, 4)]
figG = rect_shape(G, [], grid=True, size=(3.4, 2.8), title='Each square is 1 cm by 1 cm.')
assert 6 * 2 + 3 * 2 == 18
S(2, "Find the area of the shape on the squared paper.", "18 cm²", "Count the squares: the bottom part is 6 × 2 = 12 squares and the top part is 3 × 2 = 6 squares. 12 + 6 = 18 cm².", fig=figG, accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 10 * 4 + 5 * 3 == 55
figL3 = rect_shape([(0, 0), (10, 0), (10, 4), (5, 4), (5, 7), (0, 7)], [(5, -0.55, '10 cm'), (10.75, 2, '4 cm'), (7.5, 4.5, '5 cm'), (5.75, 5.5, '3 cm'), (-0.85, 3.5, '7 cm')], size=(3.8, 3.2))
S(3, "All the corners are right angles. Find the area of the shape.", "55 cm²", "Split it: bottom rectangle 10 × 4 = 40 cm²; top rectangle 5 × 3 = 15 cm². 40 + 15 = 55 cm².", fig=figL3, accept="Accept with or without the unit (cm² or m² may be typed as cm2 or m2)")
assert 15 * 9 - 4 * 3 == 123
W(3, "A garden is 15 m long and 9 m wide. There is a pond 4 m long and 3 m wide in the garden. The rest is grass. What is the area of the grass?", "15 × 9 − 4 × 3", "123 m²", "15 × 9 = 135 m². 4 × 3 = 12 m². 135 − 12 = 123 m².", marks=3, extra="135 − 12")
P(3, "A room is 6 m long and 5 m wide.", [("(a)", "What area of carpet is needed to cover the floor?", "30 m²", "accept with or without the unit"), ("(b)", "What length of skirting board is needed to go round the edge of the floor?", "22 m", "accept with or without the unit")], "Carpet covers the surface, so use area: 6 × 5 = 30 m². Skirting goes round the edge, so use perimeter: (6 + 5) × 2 = 22 m.")
assert 6 * 5 == 30 and (6 + 5) * 2 == 22

# ---------------- Unit 18: Bar charts ----------------
unit('u17')
drinks = ['Milk', 'Water', 'Lemon tea', 'Soya milk']; dv = [250, 175, 350, 100]
figD = bar_chart('Drinks sold at the tuck shop in a week', drinks, dv, 50, 400, 'Number of drinks')
M(1, "Which drink sold the most?", "Lemon tea", ["Milk", "Water", "Soya milk"], "The tallest bar is Lemon tea (350).", fig=figD)
S(1, "How many cartons of milk were sold?", 250, "The Milk bar ends at 250.", fig=figD)
assert 350 - 100 == 250
S(2, "How many more lemon teas than soya milks were sold?", 250, "350 − 100 = 250.", fig=figD)
assert sum(dv) == 875
S(2, "How many drinks were sold altogether?", 875, "250 + 175 + 350 + 100 = 875. (The Water bar ends halfway between 150 and 200, at 175.)", fig=figD)
books = ['Ken', 'Mei', 'Sam', 'Lily', 'Tom']; bv = [30, 55, 40, 70, 45]
figB = bar_chart('Books read by five children this year', books, bv, 10, 80, 'Number of books', horizontal=True)
M(2, "Who read 15 more books than Sam?", "Mei", ["Ken", "Lily", "Tom"], "Sam read 40 books. 40 + 15 = 55. Mei read 55 books.", fig=figB)
assert 40 + 15 == 55
S(2, "How many books did the five children read altogether?", sum(bv), "30 + 55 + 40 + 70 + 45 = 240.", fig=figB)
assert sum(bv) == 240
M(2, "Mrs Lam wants to draw a bar chart with 1 square for every 100 people. She has 1340 visitors on Monday. How many squares long should the bar be?", "13 squares (rounded to 1300)", ["134 squares", "14 squares", "1 square"], "Round 1340 to the nearest hundred: 1300. 1300 ÷ 100 = 13 squares.")
P(3, "Round each number to the nearest ten so it can be drawn on a bar chart where 1 square represents 10.", [("(a)", "234", "230", ""), ("(b)", "186", "190", ""), ("(c)", "345", "350", "5 rounds up")], "Look at the ones digit. 0–4 rounds down; 5–9 rounds up.")
M(3, "On a bar chart, 1 square represents 50 children. A bar is 6 and a half squares long. How many children does it show?", 325, [300, 350, 650], "6 squares = 6 × 50 = 300. Half a square = 25. 300 + 25 = 325.")
assert 6 * 50 + 25 == 325

# ---------------- build ----------------
out = {}; n = 0
for u, qs in B.items():
    for k, q in enumerate(qs):
        q['id'] = f"pm{u}{k:02d}"; q['checked'] = 'human'
        for p in q['parts']: p['mark_scheme'] = [str(m) for m in p['mark_scheme']]
    out[u] = qs; n += len(qs)
letters = [q['correct_option'] for qs in out.values() for q in qs if q['type'] == 'mcq']
print(n, 'questions;', {u: len(v) for u, v in out.items()}, 'mcq letters', {c: letters.count(c) for c in 'ABCD'}, 'figures', sum(1 for qs in out.values() for q in qs if q.get('figure')))
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
