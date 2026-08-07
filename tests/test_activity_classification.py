from garmin_sync.metrics import classify_activity_intensity

def test_classify_activity_by_training_effect():
    is_hard, tag = classify_activity_intensity(training_effect=3.0, average_hr=130)
    assert is_hard is True
    assert tag == "hard"

    is_hard_easy, tag_easy = classify_activity_intensity(training_effect=2.9, average_hr=130)
    assert is_hard_easy is False
    assert tag_easy == "moderate/easy"

def test_classify_activity_by_average_hr():
    is_hard, tag = classify_activity_intensity(training_effect=2.0, average_hr=145)
    assert is_hard is True
    assert tag == "hard"

    is_hard_mod, tag_mod = classify_activity_intensity(training_effect=2.0, average_hr=144)
    assert is_hard_mod is False
    assert tag_mod == "moderate/easy"


def test_classify_activity_uses_custom_zone4_floor():
    # HR=150 is below zone4_floor of 152, so it should be moderate/easy (TE < 3.0)
    is_hard, tag = classify_activity_intensity(training_effect=2.0, average_hr=150, zone4_floor=152)
    assert is_hard is False
    assert tag == "moderate/easy"

    # HR=152 meets zone4_floor of 152, so it should be hard
    is_hard, tag = classify_activity_intensity(training_effect=2.0, average_hr=152, zone4_floor=152)
    assert is_hard is True
    assert tag == "hard"

    # Lower zone4_floor of 140 means HR=142 is hard
    is_hard, tag = classify_activity_intensity(training_effect=2.0, average_hr=142, zone4_floor=140)
    assert is_hard is True
    assert tag == "hard"


def test_classify_activity_falls_back_when_zone4_floor_invalid():
    # None, 0, or negative zone4_floor falls back to 145
    is_hard_none, tag_none = classify_activity_intensity(training_effect=2.0, average_hr=145, zone4_floor=None)
    assert is_hard_none is True
    assert tag_none == "hard"

    is_hard_zero, tag_zero = classify_activity_intensity(training_effect=2.0, average_hr=145, zone4_floor=0)
    assert is_hard_zero is True
    assert tag_zero == "hard"

    is_hard_neg, tag_neg = classify_activity_intensity(training_effect=2.0, average_hr=145, zone4_floor=-5)
    assert is_hard_neg is True
    assert tag_neg == "hard"

