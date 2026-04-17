from django import forms
from django.contrib.auth import authenticate, get_user_model


User = get_user_model()


class LoginForm(forms.Form):
    email = forms.EmailField(label="Email", max_length=254)
    password = forms.CharField(label="Пароль", widget=forms.PasswordInput)

    def __init__(self, request=None, *args, **kwargs):
        self.request = request
        self.user = None
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned_data = super().clean()
        email = cleaned_data.get("email")
        password = cleaned_data.get("password")

        if email and password:
            self.user = authenticate(self.request, username=email, password=password)
            if self.user is None:
                raise forms.ValidationError("Неверный email или пароль.")

        return cleaned_data

    def get_user(self):
        return self.user


class RegistrationForm(forms.ModelForm):
    full_name = forms.CharField(label="ФИО", max_length=255)
    password = forms.CharField(label="Пароль", widget=forms.PasswordInput)
    password_repeat = forms.CharField(label="Повтори пароль", widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ("full_name", "email")
        labels = {
            "full_name": "ФИО",
            "email": "Email",
        }

    def clean(self):
        cleaned_data = super().clean()
        email = cleaned_data.get("email")
        password = cleaned_data.get("password")
        password_repeat = cleaned_data.get("password_repeat")
        if email:
            cleaned_data["email"] = email.strip().lower()
        if password and password_repeat and password != password_repeat:
            raise forms.ValidationError("Пароли не совпадают.")
        return cleaned_data

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data["password"])
        if commit:
            user.save()
        return user
