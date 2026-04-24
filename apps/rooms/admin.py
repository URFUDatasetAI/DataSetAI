from django.contrib import admin

from apps.rooms.models import Room, RoomAssignmentQuota, RoomJoinRequest, RoomMembership, RoomPin


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "created_by", "created_at")
    search_fields = ("title", "description", "created_by__email", "created_by__full_name")


@admin.register(RoomMembership)
class RoomMembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "status", "role", "invited_by", "joined_at")
    list_filter = ("status", "role")
    search_fields = ("room__title", "user__email", "user__full_name", "invited_by__email", "invited_by__full_name")


@admin.register(RoomAssignmentQuota)
class RoomAssignmentQuotaAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "task_quota", "created_at")
    search_fields = ("room__title", "user__email", "user__full_name")


@admin.register(RoomPin)
class RoomPinAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "created_at")
    search_fields = ("room__title", "user__email", "user__full_name")


@admin.register(RoomJoinRequest)
class RoomJoinRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "status", "reviewed_by", "reviewed_at", "created_at")
    list_filter = ("status",)
    search_fields = ("room__title", "user__email", "user__full_name", "reviewed_by__email", "reviewed_by__full_name")
